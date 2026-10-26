import { createHash } from "node:crypto";
import { z } from "zod";
import { estimateMiniMaxCostMicros, MINIMAX_TOKEN_RATES } from "../../src/modules/providers/pricing/minimax-pricing";

const endpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const model = "MiniMax-M3.1-Flash";
const m3Model = "MiniMax-M3";
const requestedModelSchema = z.enum([model, m3Model]);
const textBlockSchema = z.object({ type: z.literal("text"), text: z.string() }).strict();
// The mixed-model experiment is priced only for ordinary text generation. Reject paid
// service tiers, cache writes, tools and image inputs, including nested block extensions.
const pricedTextRequestSchema = z.object({
  model: requestedModelSchema, max_tokens: z.number().int().positive(), stream: z.literal(false),
  system: z.union([z.string(), z.array(textBlockSchema)]).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string(), z.array(textBlockSchema).min(1)]) }).strict()).min(1),
  output_config: z.object({ effort: z.enum(["low", "medium", "high", "max"]) }).strict().optional(),
  thinking: z.object({ type: z.literal("disabled") }).strict().optional(),
}).strict();
const ceiling = 7_562_784;
const duration = 30 * 60 * 1000;
const roles = ["user", "character", "reviewer"] as const;
type Role = typeof roles[number];
const limits = {
  user: { calls: 72, input: 12000, output: 4352 },
  character: { calls: 156, input: 32768, output: 4896 },
  reviewer: { calls: 6, input: 64000, output: 5596 },
} as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const policyHash = hash({ endpoint, model, ceiling, duration, limits, rates: MINIMAX_TOKEN_RATES[model] });
const nonnegative = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const safeCode = z.enum(["PERSISTENCE_UNCERTAIN", "AMBIGUOUS_CALL", "USAGE_BOUND_EXCEEDED", "MODEL_MISMATCH", "CANCELLED", "DEADLINE_EXCEEDED", "REQUEST_TIMEOUT", "NETWORK_UNCERTAIN", "HTTP_ERROR", "USAGE_UNKNOWN", "PAID_BUDGET_EXHAUSTED", "INPUT_BOUND_EXCEEDED"]);
const usageSchema = z.object({ input_tokens: nonnegative, output_tokens: nonnegative }).strict();
const scopeSchema = z.object({ trajectoryId: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u), step: nonnegative }).strict();
const entrySchema = z.object({
  id: z.string().regex(/^paid-\d+$/u), role: z.enum(roles), requestHash: digest,
  scope: scopeSchema.nullable(),
  inputBound: nonnegative, outputCap: nonnegative, reservedCostMicros: nonnegative,
  status: z.enum(["reserved", "received", "uncertain", "not_sent"]),
  measuredCostMicros: nonnegative.nullable(), usage: usageSchema.nullable(),
  requestId: z.string().max(200).regex(/^[a-zA-Z0-9._:-]+$/u).nullable(),
  model: z.string().max(100).regex(/^[a-zA-Z0-9._:-]+$/u).nullable(),
  latencyMs: nonnegative.nullable(), errorCode: safeCode.nullable(),
  requestedModel: requestedModelSchema.optional(),
}).strict();
const ledgerSchema = z.object({
  formatVersion: z.literal(1), policyHash: digest, ledgerHash: digest,
  createdAt: nonnegative, deadlineAt: nonnegative, reservedCostMicros: nonnegative,
  calls: z.object({ user: nonnegative, character: nonnegative, reviewer: nonnegative }).strict(),
  blockedReason: safeCode.nullable(), entries: z.array(entrySchema).max(234),
}).strict();
export type PaidLedger = z.infer<typeof ledgerSchema>;
type Entry = PaidLedger["entries"][number];
type SafeCode = z.infer<typeof safeCode>;
const cost = (inputTokens: number, outputTokens: number, requestedModel: string = model) => {
  const value = estimateMiniMaxCostMicros({ modelVersion: requestedModel, inputTokens, outputTokens });
  if (value === null || !Number.isSafeInteger(value)) throw new Error("UNKNOWN_PRICE");
  return value;
};
function stamp(ledger: PaidLedger): PaidLedger {
  const { ledgerHash: _hash, ...contents } = ledger;
  void _hash;
  return { ...contents, ledgerHash: hash(contents) };
}
type Policy = { mixed: boolean; ceiling: number; hash: string };
function restore(prior: unknown, policy: Policy): PaidLedger {
  const ledger = ledgerSchema.parse(prior);
  if (ledger.policyHash !== policy.hash || stamp(ledger).ledgerHash !== ledger.ledgerHash
    || ledger.deadlineAt !== ledger.createdAt + duration
    || ledger.reservedCostMicros > policy.ceiling
    || ledger.reservedCostMicros !== ledger.entries.reduce((sum, entry) => sum + entry.reservedCostMicros, 0)) throw new Error("INVALID_PAID_LEDGER");
  for (const role of roles) {
    if (ledger.calls[role] > limits[role].calls || ledger.calls[role] !== ledger.entries.filter((entry) => entry.role === role).length) throw new Error("INVALID_PAID_LEDGER");
  }
  for (const [index, entry] of ledger.entries.entries()) {
    const requestedModel = entry.requestedModel ?? model;
    if ((policy.mixed && entry.requestedModel === undefined) || (!policy.mixed && entry.requestedModel !== undefined)
      || (requestedModel === m3Model && (entry.role !== "character" || entry.outputCap > 800))) throw new Error("INVALID_PAID_LEDGER");
    if (entry.id !== `paid-${index + 1}` || entry.inputBound < 1024 || entry.inputBound > limits[entry.role].input
      || entry.outputCap < 1 || entry.outputCap > limits[entry.role].output
      || entry.reservedCostMicros !== cost(entry.inputBound, entry.outputCap, requestedModel)
      || entry.measuredCostMicros !== (entry.usage && (!policy.mixed || entry.model === requestedModel) ? cost(entry.usage.input_tokens, entry.usage.output_tokens, requestedModel) : null)
      || (entry.status !== "received" && (entry.usage !== null || entry.measuredCostMicros !== null))
      || (entry.status === "reserved" && (entry.requestId !== null || entry.model !== null || entry.latencyMs !== null || entry.errorCode !== null))) throw new Error("INVALID_PAID_LEDGER");
  }
  if (ledger.entries.some((entry) => entry.usage && (entry.usage.input_tokens > entry.inputBound || entry.usage.output_tokens > entry.outputCap))
    && ledger.blockedReason !== "USAGE_BOUND_EXCEEDED") throw new Error("INVALID_PAID_LEDGER");
  if (ledger.entries.some((entry) => policy.mixed ? entry.status === "received" && entry.model !== entry.requestedModel : entry.model && entry.model !== model)
    && !ledger.blockedReason) throw new Error("INVALID_PAID_LEDGER");
  return ledger;
}

/** A private audit ledger: reservations are planning upper bounds, never measured usage. */
export function createPaidTransport(options: {
  apiKey: string; prior?: unknown; persist: (ledger: PaidLedger) => Promise<void>;
  fetchImplementation?: typeof fetch; now?: () => number; signal?: AbortSignal;
  modelPolicy?: "flash-m3-v1"; ceilingMicros?: number;
}) {
  if (!options.apiKey.trim()) throw new Error("API_KEY_REQUIRED");
  const ceilingResult = z.number().int().nonnegative().max(ceiling).safeParse(options.ceilingMicros === undefined ? ceiling : options.ceilingMicros);
  if (!ceilingResult.success || (options.modelPolicy !== undefined && options.modelPolicy !== "flash-m3-v1")) throw new Error("INVALID_PAID_POLICY");
  const mixed = options.modelPolicy === "flash-m3-v1";
  const effectiveCeiling = ceilingResult.data;
  const policy: Policy = { mixed, ceiling: effectiveCeiling, hash: mixed
    ? hash({ modelPolicy: "flash-m3-v1", requestShape: "priced-text-only-v1", endpoint, models: [model, m3Model], ceiling: effectiveCeiling, duration, limits,
      m3: { role: "character", output: 800 }, rates: { [model]: MINIMAX_TOKEN_RATES[model], [m3Model]: MINIMAX_TOKEN_RATES[m3Model] } })
    : effectiveCeiling === ceiling ? policyHash : hash({ endpoint, model, ceiling: effectiveCeiling, duration, limits, rates: MINIMAX_TOKEN_RATES[model] }) };
  const now = options.now ?? Date.now;
  const createdAt = now();
  let ledger: PaidLedger = options.prior === undefined ? stamp({
    formatVersion: 1, policyHash: policy.hash, ledgerHash: "", createdAt, deadlineAt: createdAt + duration,
    reservedCostMicros: 0, calls: { user: 0, character: 0, reviewer: 0 }, blockedReason: null, entries: [],
  }) : restore(options.prior, policy);
  if (ledger.entries.some((entry) => entry.status === "reserved" || entry.status === "uncertain")) ledger.blockedReason ??= "AMBIGUOUS_CALL";
  let busy = false;
  const snapshot = () => structuredClone(stamp(ledger));
  const persist = async () => {
    ledger = stamp(ledger);
    try { await options.persist(snapshot()); }
    catch { ledger.blockedReason = "PERSISTENCE_UNCERTAIN"; throw new Error("PERSISTENCE_UNCERTAIN"); }
  };
  const block = async (code: SafeCode): Promise<never> => {
    ledger.blockedReason = code; await persist(); throw new Error(code);
  };
  const execute = async ({ role, input, init, scope }: { role: Role; input: RequestInfo | URL; init?: RequestInit; scope?: z.infer<typeof scopeSchema> }): Promise<Response> => {
    if (busy) throw new Error("TRANSPORT_BUSY");
    if (ledger.blockedReason) throw new Error(ledger.blockedReason);
    busy = true;
    try {
      if (!roles.includes(role)) throw new Error("INVALID_ROLE");
      const auditScope = scope === undefined ? null : scopeSchema.parse(scope);
      const request = new Request(input, init);
      if (request.url !== endpoint || request.method !== "POST") throw new Error("REQUEST_NOT_ALLOWED");
      if (options.signal?.aborted || request.signal.aborted) throw new Error("CANCELLED");
      if (now() >= ledger.deadlineAt) return await block("DEADLINE_EXCEEDED");
      const body = await request.text();
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { throw new Error("INVALID_REQUEST_BODY"); }
      if (policy.mixed && !pricedTextRequestSchema.safeParse(parsed).success) throw new Error("REQUEST_NOT_ALLOWED");
      const validated = z.object({ model: requestedModelSchema, max_tokens: z.number().int().positive().max(limits[role].output), stream: z.literal(false) }).safeParse(parsed);
      if (!validated.success || (validated.data.model === m3Model && (!policy.mixed || role !== "character" || validated.data.max_tokens > 800))) throw new Error("REQUEST_NOT_ALLOWED");
      const requestedModel = validated.data.model;
      // UTF-8 byte bound plus fixed protocol allowance; explicitly NOT usage measurement.
      const inputBound = Buffer.byteLength(body, "utf8") + 1024;
      if (inputBound > limits[role].input) return await block("INPUT_BOUND_EXCEEDED");
      const outputCap = validated.data.max_tokens;
      const reservedCostMicros = cost(inputBound, outputCap, requestedModel);
      if (ledger.calls[role] >= limits[role].calls || ledger.reservedCostMicros + reservedCostMicros > policy.ceiling) return await block("PAID_BUDGET_EXHAUSTED");
      const entry: Entry = {
        id: `paid-${ledger.entries.length + 1}`, role, requestHash: hash({ endpoint, method: "POST", body }), scope: auditScope, inputBound, outputCap, reservedCostMicros,
        status: "reserved", measuredCostMicros: null, usage: null, requestId: null, model: null, latencyMs: null, errorCode: null,
        ...(policy.mixed ? { requestedModel } : {}),
      };
      ledger.entries.push(entry); ledger.calls[role]++; ledger.reservedCostMicros += reservedCostMicros;
      await persist();
      const remaining = ledger.deadlineAt - now();
      if (remaining <= 0 || options.signal?.aborted || request.signal.aborted) {
        entry.status = "not_sent"; entry.errorCode = remaining <= 0 ? "DEADLINE_EXCEEDED" : "CANCELLED";
        if (remaining <= 0) ledger.blockedReason = "DEADLINE_EXCEEDED";
        entry.latencyMs = 0; await persist(); throw new Error(entry.errorCode);
      }
      const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.min(90000, Math.floor(remaining))));
      const signal = AbortSignal.any([request.signal, deadlineSignal, ...(options.signal ? [options.signal] : [])]);
      const started = now();
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("TRANSPORT_ABORTED"));
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      let response: Response;
      let responseData: unknown;
      try {
        ({ response, responseData } = await Promise.race([
          Promise.resolve().then(async () => {
            if (signal.aborted) throw new Error("TRANSPORT_ABORTED");
            const response = await (options.fetchImplementation ?? fetch)(endpoint, {
              method: "POST", body, redirect: "error", signal,
              headers: { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            });
            let responseData: unknown = null;
            try { responseData = await response.clone().json(); } catch { /* Unknown usage remains null. */ }
            return { response, responseData };
          }), aborted,
        ]));
      } catch {
        const code: SafeCode = options.signal?.aborted || request.signal.aborted ? "CANCELLED"
          : deadlineSignal.aborted ? (now() >= ledger.deadlineAt ? "DEADLINE_EXCEEDED" : "REQUEST_TIMEOUT") : "NETWORK_UNCERTAIN";
        entry.status = "uncertain"; entry.errorCode = code; entry.latencyMs = Math.max(0, Math.floor(now() - started));
        ledger.blockedReason = "AMBIGUOUS_CALL";
        await persist(); throw new Error(code);
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
      entry.status = "received"; entry.latencyMs = Math.max(0, Math.floor(now() - started));
      const metadata = z.object({ usage: z.object({ input_tokens: nonnegative, output_tokens: nonnegative }).optional(), model: z.string().optional(), id: z.string().optional() }).safeParse(responseData);
      if (policy.mixed) {
        // Parse model identity independently: invalid usage is unknown, not evidence of a different model.
        const identity = z.object({ model: z.string().optional(), id: z.string().optional(), usage: z.unknown().optional() }).safeParse(responseData);
        if (identity.success) {
          const id = response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? identity.data.id;
          entry.requestId = typeof id === "string" && /^[a-zA-Z0-9._:-]{1,200}$/u.test(id) ? id : null;
          entry.model = identity.data.model && /^[a-zA-Z0-9._:-]{1,100}$/u.test(identity.data.model) ? identity.data.model : null;
          const usage = z.object({ input_tokens: nonnegative, output_tokens: nonnegative }).safeParse(identity.data.usage);
          if (response.ok && usage.success) {
            entry.usage = usage.data;
            // A mismatched/absent identity cannot honestly be billed using the requested rate.
            if (entry.model === requestedModel) entry.measuredCostMicros = cost(entry.usage.input_tokens, entry.usage.output_tokens, requestedModel);
          }
        }
      } else if (metadata.success) {
        const id = response.headers.get("request-id") ?? response.headers.get("x-request-id") ?? metadata.data.id;
        entry.requestId = typeof id === "string" && /^[a-zA-Z0-9._:-]{1,200}$/u.test(id) ? id : null;
        entry.model = metadata.data.model && /^[a-zA-Z0-9._:-]{1,100}$/u.test(metadata.data.model) ? metadata.data.model : null;
        if (response.ok && metadata.data.usage) {
          entry.usage = metadata.data.usage;
          entry.measuredCostMicros = cost(entry.usage.input_tokens, entry.usage.output_tokens);
        }
      }
      entry.errorCode = !response.ok ? "HTTP_ERROR" : !entry.usage ? "USAGE_UNKNOWN" : null;
      if (policy.mixed ? entry.model !== requestedModel : entry.model && entry.model !== model) { entry.errorCode = "MODEL_MISMATCH"; ledger.blockedReason = "MODEL_MISMATCH"; }
      if (entry.usage && (entry.usage.input_tokens > inputBound || entry.usage.output_tokens > outputCap)) {
        entry.errorCode = "USAGE_BOUND_EXCEEDED"; ledger.blockedReason = "USAGE_BOUND_EXCEEDED";
      }
      await persist();
      if (ledger.blockedReason) throw new Error(ledger.blockedReason);
      return response;
    } finally { busy = false; }
  };
  return { execute, snapshot };
}
