import { createHash } from "node:crypto";
import { z } from "zod";
import { estimateMiniMaxCostMicros } from "../../src/modules/providers/pricing/minimax-pricing";
import { miniMaxOutputBudget } from "../../src/modules/providers/minimax/text-model";

export const safeId = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u)
  .refine((s) => !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(s));
export const participantRoles = ["user", "character", "reviewer"] as const;
export type ParticipantRole = typeof participantRoles[number];
const quota = z.object({
  maxCalls: z.number().int().nonnegative().max(10000),
  inputTokensPerCall: z.number().int().positive().max(1000000),
  outputTokensPerCall: z.number().int().positive().max(100000),
  maxReservedTokens: z.number().int().nonnegative().max(100000000),
}).strict();
export const fakeManifestSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal("fake"),
  runId: safeId, trajectoryId: safeId, routeId: z.enum(["R01", "R04", "R05", "R06"]),
  routeHash: z.string().regex(/^[a-f0-9]{64}$/u),
  codeFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  characterHash: z.string().regex(/^[a-f0-9]{64}$/u),
  characterVersion: z.number().int().positive(),
  characterSource: z.literal("local-authored-test-projection"),
  /** Maximum safety-only rewrites per character reply. Optional for legacy checkpoints. */
  safetyRetryLimit: z.number().int().min(0).max(3).optional(),
  participants: z.object({ user: z.literal("scripted-fake-v1"), character: z.literal("scripted-fake-v1"), reviewer: z.literal("fake-structural-v1") }).strict(),
  evaluationSet: z.enum(["calibration", "holdout"]),
  budget: z.object({ user: quota, character: quota, reviewer: quota }).strict(),
  maxCostMicros: z.literal(0),
  maxWallMs: z.number().int().positive().max(3600000),
}).strict();
export const realManifestSchema = fakeManifestSchema.extend({
  schemaVersion: z.literal(2), mode: z.literal("real"),
  participants: z.object({
    user: z.enum(["MiniMax-M3.1-Flash/actor-v1", "scripted-user-v2"]),
    character: z.enum(["MiniMax-M3.1-Flash/product", "DeepSeek/deepseek-flash/product"]),
    reviewer: z.enum(["MiniMax-M3.1-Flash/reviewer-v1", "DeepSeek/deepseek-flash/reviewer-v1"]),
  }).strict(),
  maxCostMicros: z.literal(7562784),
  budgetScope: z.enum(["entire-three-trajectory-batch", "selected-core-routes", "single-romance-confirmation-route"]),
  authorization: z.literal("owner-continue-after-2026-10-25-budget-proposal"),
}).strict();
export const manifestSchema = z.discriminatedUnion("mode", [fakeManifestSchema, realManifestSchema]);
export type EvaluationManifest = z.infer<typeof manifestSchema>;
export const stepSchema = z.object({
  session: z.number().int().positive(), at: z.iso.datetime(),
  kind: z.enum(["user", "proactive"]),
  lifeEvent: z.string().min(1).max(2000),
  fakeReply: z.string().min(1).max(2000),
}).strict();
export const routeSchema = z.object({
  routeId: z.enum(["R01", "R04", "R05", "R06"]), label: z.string().min(1),
  persona: z.string().min(1), expectedOutcome: z.string().min(1),
  mustAvoid: z.array(z.string()), steps: z.array(stepSchema).min(1).max(500),
}).strict().superRefine((route, ctx) => {
  for (let i = 1; i < route.steps.length; i++) {
    if (route.steps[i].session < route.steps[i - 1].session || Date.parse(route.steps[i].at) < Date.parse(route.steps[i - 1].at)) {
      ctx.addIssue({ code: "custom", message: "CLOCK_OR_SESSION_REVERSED", path: ["steps", i] });
    }
  }
});
export type EvaluationRoute = z.infer<typeof routeSchema>;
export function fingerprint(value: unknown): string {
  // Object-key order is normalised so parsed/resumed manifests have stable identity.
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" && !(v instanceof Date)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

/** Conservative planning caps, NOT measured usage and NOT authority to call a provider. */
export function estimateBaselineBudget(model = "MiniMax-M3.1-Flash") {
  const caps = {
    user: { calls: 72, input: 12000, output: miniMaxOutputBudget(model, 256) },
    character: { calls: 156, input: 12000, output: miniMaxOutputBudget(model, 800) },
    reviewer: { calls: 6, input: 64000, output: miniMaxOutputBudget(model, 1500) },
  };
  const roles = Object.fromEntries(participantRoles.map((role) => {
    const cap = caps[role];
    const cost = estimateMiniMaxCostMicros({ modelVersion: model, inputTokens: cap.input, outputTokens: cap.output });
    if (cost === null) throw new Error("UNKNOWN_PRICE");
    return [role, { calls: cap.calls, inputTokens: cap.calls * cap.input, outputTokens: cap.calls * cap.output, costMicros: cap.calls * cost }];
  })) as Record<ParticipantRole, { calls: number; inputTokens: number; outputTokens: number; costMicros: number }>;
  const total = Object.values(roles).reduce((sum, r) => sum + r.costMicros, 0);
  return { model, currency: "CNY", rateSource: "src/modules/providers/pricing/minimax-pricing.ts (2026-10-25)",
    assumptions: "All three participants use the same priced model; output caps include reasoning. No cache discount. 72 user turns, 6 proactive opportunities, at most one character retry, two reviews per trajectory. Extraction is deterministic (0 paid calls). Must re-estimate if actual models, input bounds or retries change.",
    roles, totalCalls: Object.values(roles).reduce((s, r) => s + r.calls, 0), totalCny: total / 1000000,
    authorizedRealCostMicros: 0, wallTimeCeilingMinutes: 30,
  };
}
