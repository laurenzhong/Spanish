import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

const endpoint = "https://api.deepseek.com/v1/chat/completions";
const model = "deepseek-flash" as const;
const ceiling = 7_562_784;
const roleLimits = {
  user: { calls: 72, input: 12000, output: 4352 },
  character: { calls: 156, input: 32768, output: 4896 },
  reviewer: { calls: 6, input: 64000, output: 12000 },
} as const;
const roleSchema = z.enum(["user", "character", "reviewer"]);
const entrySchema = z.object({
  id: z.string(), role: roleSchema, status: z.enum(["reserved", "received", "not_sent", "uncertain"]),
  requestedModel: z.literal(model), model: z.string().nullable(), requestId: z.string().nullable(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/u), inputBound: z.number().int().positive(),
  reservedCostMicros: z.number().int().positive(), measuredCostMicros: z.null(),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).strict().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(), errorCode: z.string().nullable(),
  scope: z.object({ trajectoryId: z.string(), step: z.number().int().nonnegative() }).strict().nullable(),
}).strict();
const ledgerSchema = z.object({ formatVersion: z.literal(1), provider: z.literal("deepseek"), model: z.literal(model),
  endpoint: z.literal(endpoint), ceilingMicros: z.literal(ceiling), createdAt: z.number().int().positive(),
  reservedCostMicros: z.number().int().nonnegative(), calls: z.object({ user: z.number().int().nonnegative(), character: z.number().int().nonnegative(), reviewer: z.number().int().nonnegative() }).strict(),
  blockedReason: z.string().nullable(), entries: z.array(entrySchema), hash: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export type DeepSeekPaidLedger = z.infer<typeof ledgerSchema>;
export type DeepSeekTransport = {
  execute: (request: { role: "user" | "character" | "reviewer"; input: RequestInfo | URL; init?: RequestInit; scope?: { trajectoryId: string; step: number } }) => Promise<Response>;
  snapshot: () => DeepSeekPaidLedger;
};

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function seal(value: Omit<DeepSeekPaidLedger, "hash">): DeepSeekPaidLedger { return ledgerSchema.parse({ ...value, hash: hash(value) }); }

export function createDeepSeekPaidTransport(options: {
  apiKey: string; prior?: unknown; persist: (ledger: DeepSeekPaidLedger) => Promise<void> | void;
  signal?: AbortSignal; fetchImplementation?: typeof fetch; now?: () => number;
}): DeepSeekTransport {
  if (!options.apiKey.trim()) throw new Error("DEEPSEEK_API_KEY_REQUIRED");
  const network = options.fetchImplementation ?? fetch;
  const now = options.now ?? Date.now;
  let ledger = options.prior ? ledgerSchema.parse(options.prior) : seal({ formatVersion: 1, provider: "deepseek", model, endpoint, ceilingMicros: ceiling,
    createdAt: now(), reservedCostMicros: 0, calls: { user: 0, character: 0, reviewer: 0 }, blockedReason: null, entries: [] });
  let busy = false;
  const persist = async () => { ledger = seal({ ...ledger, entries: ledger.entries.map((entry) => ({ ...entry })), calls: { ...ledger.calls } }); await options.persist(ledger); };
  const failClosed = async (reason: string) => { ledger = seal({ ...ledger, blockedReason: reason }); await persist(); };
  return {
    async execute(request) {
      if (busy) throw new Error("DEEPSEEK_TRANSPORT_BUSY");
      busy = true;
      try {
        if (options.signal?.aborted) throw new Error("DEEPSEEK_CANCELLED");
        const init = request.init ?? {};
        if (request.input.toString() !== endpoint || init.method !== "POST" || typeof init.body !== "string") throw new Error("DEEPSEEK_REQUEST_NOT_ALLOWED");
        let body: unknown;
        try { body = JSON.parse(init.body); } catch { throw new Error("DEEPSEEK_REQUEST_NOT_ALLOWED"); }
        const parsed = z.object({ model: z.literal(model), max_tokens: z.number().int().positive(), stream: z.literal(false), messages: z.array(z.unknown()).min(1) }).passthrough().safeParse(body);
        if (!parsed.success || parsed.data.max_tokens > roleLimits[request.role].output) throw new Error("DEEPSEEK_REQUEST_NOT_ALLOWED");
        const inputBound = Buffer.byteLength(init.body) + 1024;
        if (inputBound > roleLimits[request.role].input * 4) throw new Error("DEEPSEEK_INPUT_BOUND_EXCEEDED");
        const reserved = inputBound + parsed.data.max_tokens * 4;
        if (ledger.blockedReason) throw new Error(ledger.blockedReason);
        if (ledger.calls[request.role] >= roleLimits[request.role].calls || ledger.reservedCostMicros + reserved > ceiling) {
          await failClosed("DEEPSEEK_BUDGET_EXHAUSTED"); throw new Error("DEEPSEEK_BUDGET_EXHAUSTED");
        }
        const entry = { id: randomUUID(), role: request.role, status: "reserved" as const, requestedModel: model, model: null,
          requestId: null, requestHash: hash(body), inputBound, reservedCostMicros: reserved, measuredCostMicros: null,
          usage: null, latencyMs: null, errorCode: null, scope: request.scope ?? null };
        ledger = seal({ ...ledger, reservedCostMicros: ledger.reservedCostMicros + reserved,
          calls: { ...ledger.calls, [request.role]: ledger.calls[request.role] + 1 }, entries: [...ledger.entries, entry] });
        try { await persist(); } catch { await failClosed("DEEPSEEK_PERSISTENCE_UNCERTAIN"); throw new Error("DEEPSEEK_PERSISTENCE_UNCERTAIN"); }
        if (options.signal?.aborted) { const index = ledger.entries.length - 1; ledger.entries[index] = { ...ledger.entries[index], status: "not_sent", errorCode: "CANCELLED" }; await persist(); throw new Error("DEEPSEEK_CANCELLED"); }
        const started = now();
        let response: Response;
        try {
          response = await network(endpoint, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` }, signal: options.signal });
        } catch {
          const index = ledger.entries.length - 1; ledger.entries[index] = { ...ledger.entries[index], status: "uncertain", errorCode: "NETWORK_UNCERTAIN", latencyMs: Math.max(0, now() - started) }; await persist();
          throw new Error("DEEPSEEK_NETWORK_UNCERTAIN");
        }
        const index = ledger.entries.length - 1;
        let responseData: unknown = null;
        try { responseData = await response.clone().json(); } catch { /* usage stays unknown */ }
        const identity = z.object({ model: z.string().optional(), id: z.string().optional(), usage: z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() }).optional() }).passthrough().safeParse(responseData);
        const usage = identity.success && identity.data.usage ? { input_tokens: identity.data.usage.prompt_tokens, output_tokens: identity.data.usage.completion_tokens } : null;
        ledger.entries[index] = { ...ledger.entries[index], status: "received", model: identity.success && identity.data.model && /^[a-zA-Z0-9._:-]{1,100}$/u.test(identity.data.model) ? identity.data.model : null,
          requestId: identity.success ? identity.data.id ?? response.headers.get("x-request-id") : response.headers.get("x-request-id"), usage,
          latencyMs: Math.max(0, now() - started), errorCode: response.ok ? (usage ? null : "USAGE_UNKNOWN") : "HTTP_ERROR" };
        await persist();
        return response;
      } finally { busy = false; }
    },
    snapshot: () => ledger,
  };
}

