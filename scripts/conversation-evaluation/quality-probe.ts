import { createHash } from "node:crypto";
import { z } from "zod";
import { buildReplyContext, type ReplyContext } from "../../src/modules/conversation/application/build-reply-context";
import { streamReply } from "../../src/modules/conversation/application/stream-reply";
import { englishFragments } from "../../src/modules/conversation/domain/language-purity";
import { hasProviderOutputContamination } from "../../src/modules/conversation/domain/provider-output-integrity";
import { ConversationProviderError, characterContextForProvider, type ConversationProviderResult } from "../../src/modules/providers/conversation/conversation";
import { MiniMaxConversationProvider } from "../../src/modules/providers/conversation/minimax-conversation";
import type { EvaluationHttpExecutor } from "./real-provider";
import { hasProviderPlanning, redactProviderText } from "./redaction";

export type ProbeCase = Readonly<{
  id: string;
  split: "diagnostic" | "holdout";
  userMessage: string;
  recentMessages: ReplyContext["recentMessages"];
}>;
export type ProbeModelVersion = "MiniMax-M3.1-Flash" | "MiniMax-M3";
export type ProbeVariant = Readonly<{ id: string; effort: "low" | "max" | "native"; modelVersion?: ProbeModelVersion; systemOverride?: string }>;
export type ProbeRequestConfiguration = Readonly<{
  modelVersion: ProbeModelVersion; maxTokens: number; thinking: "required" | "disabled"; effort: "low" | "max" | null;
}>;
export type ProbeRecord = Readonly<{
  ordinal: number;
  caseId: string;
  split: ProbeCase["split"];
  variantId: string;
  effort: ProbeVariant["effort"];
  /** Absent only for legacy prompt-only probes, whose model was implicitly Flash. */
  modelVersion?: ProbeModelVersion;
  requestConfiguration?: ProbeRequestConfiguration | null;
  repetition: number;
  context: ReplyContext;
  requestHash: string | null;
  systemHash: string | null;
  inputHash: string | null;
  text: string | null;
  gatePassed: boolean | null;
  flags: Readonly<{ contamination: boolean; englishFragments: readonly string[] }>;
  latencyMs: number;
  errorCode: string | null;
}>;

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/u);
const caseSchema = z.object({ id: idSchema, split: z.enum(["diagnostic", "holdout"]), userMessage: z.string().trim().min(1).max(2000),
  recentMessages: z.array(z.object({ role: z.enum(["user", "character"]), content: z.string().min(1).max(8000), sentAt: z.iso.datetime().optional() }).strict()).max(100),
}).strict();
const variantSchema = z.object({ id: idSchema, effort: z.enum(["low", "max", "native"]),
  modelVersion: z.enum(["MiniMax-M3.1-Flash", "MiniMax-M3"]).optional(), systemOverride: z.string().trim().min(1).max(30000).optional(),
}).strict().refine(variant => (variant.modelVersion === "MiniMax-M3") === (variant.effort === "native"), "Model and effort must use a supported native configuration");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

/** Test one candidate against the actual product gate, never request a paid retry. */
export async function probeCandidateGate(context: ReplyContext, result: ConversationProviderResult): Promise<boolean> {
  let replayCalls = 0;
  let done = false;
  for await (const event of streamReply({ characterKey: "lucia", characterVersion: context.character.characterVersion,
    text: context.userMessage, clientMessageId: "quality-probe-client", generationId: context.generationId, messageId: "quality-probe-reply",
    replyContext: context, replyProvider: { generate: async () => { replayCalls++; return result; } }, wait: async () => {},
  })) if (event.type === "done") done = true;
  // A rejected first candidate cannot be rescued by the replay's changed retry policy.
  return done && replayCalls === 1;
}

/** Isolated single-turn probes: no memory writes, conversation chaining, network retry or quality verdict. */
export async function runQualityProbe(input: {
  cases: readonly ProbeCase[];
  variants: readonly ProbeVariant[];
  repetitions: number;
  execute: EvaluationHttpExecutor;
  persist: (record: ProbeRecord) => Promise<void>;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<readonly ProbeRecord[]> {
  const cases = z.array(caseSchema).min(1).parse(input.cases);
  const variants = z.array(variantSchema).min(1).parse(input.variants);
  const repetitions = z.number().int().min(1).max(100).parse(input.repetitions);
  if (!input.apiKey.trim()) throw new Error("PROBE_API_KEY_REQUIRED");
  if (new Set(cases.map((item) => item.id)).size !== cases.length || new Set(variants.map((item) => item.id)).size !== variants.length) {
    throw new Error("PROBE_DUPLICATE_ID");
  }
  const records: ProbeRecord[] = [];
  for (const [caseIndex, fixture] of cases.entries()) {
    // No arm label, grading rubric, split or expected outcome enters model context.
    const context = await buildReplyContext({ generationId: `quality-probe-${fixture.id}`, userId: "synthetic-quality-probe",
      userMessage: fixture.userMessage, recentMessages: fixture.recentMessages, now: new Date("2026-10-25T10:00:00.000Z") });
    const archivedContext = { ...context, character: characterContextForProvider(context) };
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const offset = (caseIndex + repetition) % variants.length;
      const ordered = [...variants.slice(offset), ...variants.slice(0, offset)];
      for (const variant of ordered) {
        if (input.signal?.aborted) return freezeDeep(records);
        let requestHash: string | null = null;
        let systemHash: string | null = null;
        let inputHash: string | null = null;
        let requestConfiguration: ProbeRequestConfiguration | null = null;
        let text: string | null = null;
        let gatePassed: boolean | null = null;
        let errorCode: string | null = null;
        let flags: ProbeRecord["flags"] = { contamination: false, englishFragments: [] };
        const startedAt = Date.now();
        const provider = new MiniMaxConversationProvider({ apiKey: input.apiKey, endpoint: "https://api.minimaxi.com/anthropic/v1/messages",
          modelVersion: variant.modelVersion ?? "MiniMax-M3.1-Flash", fetchImplementation: async (url, init) => {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            // M3 uses the existing adapter's disabled thinking and 800-token answer
            // budget. Do not apply a Flash effort option or reserve to that model.
            if (variant.effort !== "native") body.output_config = { ...(body.output_config as Record<string, unknown>), effort: variant.effort };
            if (variant.systemOverride !== undefined) body.system = variant.systemOverride;
            if (variant.modelVersion !== undefined) requestConfiguration = {
              modelVersion: variant.modelVersion, maxTokens: Number(body.max_tokens),
              thinking: (body.thinking as { type?: string } | undefined)?.type === "disabled" ? "disabled" : "required",
              effort: (body.output_config as { effort?: "low" | "max" } | undefined)?.effort ?? null,
            };
            const encoded = JSON.stringify(body);
            requestHash = hash(encoded); systemHash = hash(String(body.system)); inputHash = hash(JSON.stringify(body.messages));
            return input.execute({ role: "character", input: url, init: { ...init, body: encoded } });
          } });
        try {
          const result = await provider.generate(context, { signal: input.signal });
          text = redactProviderText(result.text);
          flags = { contamination: hasProviderOutputContamination(result.text) || hasProviderPlanning(result.text),
            englishFragments: englishFragments(result.text).map((fragment) => fragment.phrase) };
          gatePassed = await probeCandidateGate(context, result);
        } catch (error) {
          // Never preserve an exception body: providers may include sensitive response/request data.
          errorCode = input.signal?.aborted ? "PROBE_CANCELLED"
            : error instanceof ConversationProviderError ? error.code : "PROBE_GENERATION_FAILED";
        }
        const record = freezeDeep<ProbeRecord>({ ordinal: records.length, caseId: fixture.id, split: fixture.split, variantId: variant.id,
          effort: variant.effort, repetition, context: structuredClone(archivedContext), requestHash, systemHash, inputHash,
          ...(variant.modelVersion !== undefined ? { modelVersion: variant.modelVersion, requestConfiguration } : {}),
          text, gatePassed, flags, latencyMs: Math.max(0, Date.now() - startedAt), errorCode });
        // Persistence failure stops the probe. It is not a provider failure or an invitation to retry.
        await input.persist(record);
        records.push(record);
      }
    }
  }
  return freezeDeep(records);
}
