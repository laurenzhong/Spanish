import { z } from "zod";
import { buildReplyContext } from "../../src/modules/conversation/application/build-reply-context";
import { resolveConversationCharacter } from "../../src/modules/conversation/application/resolve-character-runtime";
import { streamReply } from "../../src/modules/conversation/application/stream-reply";
import { generateLuciaProactiveMessage } from "../../src/modules/conversation/application/generate-proactive-message";
import { extractMemories } from "../../src/modules/memory/application/extract-memories";
import { commitMemories } from "../../src/modules/memory/application/commit-memories";
import type { ConversationProviderInput, ConversationProviderResult } from "../../src/modules/providers/conversation/conversation";
import type { ConversationMessageRecord } from "../../src/modules/conversation/repositories/conversation-repository";
import { createConversationSandbox, type SandboxSnapshot } from "./sandbox";
import { admitEvaluationRelationshipTurn, createEvaluationRelationshipProjection, rebaseEvaluationRelationshipProjection, type EvaluationRelationshipProjection } from "./relationship-projection";
import { redactCheckpointText, redactProviderText } from "./redaction";
import { fingerprint, manifestSchema, routeSchema, participantRoles, type EvaluationManifest, type EvaluationRoute, type ParticipantRole } from "./manifest";

const usageSchema = z.object({ calls: z.number().int().nonnegative(), reservedTokens: z.number().int().nonnegative() }).strict();
const traceSchema = z.object({
  id: z.string(), role: z.enum(participantRoles), step: z.number().int(),
  outcome: z.enum(["returned", "failed", "cancelled"]), output: z.string().nullable(),
  invoked: z.boolean(),
  gate: z.string().nullable(), durationMs: z.number().nonnegative(), costMicros: z.number().nonnegative().nullable(),
  provider: z.string().optional(), modelVersion: z.string().optional(), providerRequestId: z.string().nullable().optional(),
  inputHash: z.string(), contextStage: z.string().optional(), memoryKeys: z.array(z.string()).optional(),
  recentMessageCount: z.number().int().optional(), recentMessageCharacters: z.number().int().optional(),
}).strict();
const turnSchema = z.object({
  step: z.number().int(), session: z.number().int(), at: z.iso.datetime(), kind: z.enum(["user", "proactive"]),
  generationId: z.string(), done: z.boolean(), result: z.string(), memoryCountBefore: z.number(), memoryCountAfter: z.number(),
  stageBefore: z.enum(["new_contact", "getting_to_know_you", "familiar", "close_friend"]),
  stageAfter: z.enum(["new_contact", "getting_to_know_you", "familiar", "close_friend"]),
}).strict();
const reviewSchema = z.object({ reviewer: z.string(), verdict: z.enum(["not_evaluated", "reviewed"]), notes: z.string(), evidenceSteps: z.array(z.number().int()),
  findings: z.array(z.object({ severity: z.enum(["high", "medium", "low"]), category: z.string(), step: z.number().int(), quote: z.string(), issue: z.string() }).strict()).optional(),
}).strict();
const checkpointSchema = z.object({
  formatVersion: z.literal(1), manifest: manifestSchema, manifestHash: z.string(),
  status: z.enum(["running", "paused", "completed", "cancelled", "budget_exhausted", "failed", "interrupted"]),
  cursor: z.number().int().nonnegative(), activeStep: z.number().int().nullable(), pending: z.string().nullable(),
  elapsedMs: z.number().nonnegative(), sandbox: z.unknown(),
  ledger: z.object({ user: usageSchema, character: usageSchema, reviewer: usageSchema }).strict(),
  traces: z.array(traceSchema), turns: z.array(turnSchema), reviews: z.array(reviewSchema),
  limitations: z.array(z.string()), errorCode: z.string().nullable(),
  partial: z.object({ id: z.string(), generationId: z.string(), content: z.string(), at: z.iso.datetime(), replyTo: z.string() }).nullable(),
  relationship: z.unknown().optional(),
  prefixHashes: z.array(z.string()), personaHash: z.string(),
  parent: z.object({ runId: z.string(), trajectoryId: z.string(), checkpointHash: z.string(), cursor: z.number().int() }).optional(),
}).strict();
export type EvaluationCheckpoint = Omit<z.infer<typeof checkpointSchema>, "sandbox" | "relationship"> & { sandbox: SandboxSnapshot; relationship: EvaluationRelationshipProjection };
type Review = z.infer<typeof reviewSchema>;
type VisibleMessage = { role: "user" | "character"; content: string; at: string; status: string; step?: number };
export type UserView = { persona: string; lifeEvent: string; session: number; transcript: VisibleMessage[] };
export type ReviewerView = { expectedOutcome: string; mustAvoid: string[]; transcript: VisibleMessage[]; turns: EvaluationCheckpoint["turns"]; limitations: string[] };
export type OfflineParticipants = {
  user: (input: UserView, signal: AbortSignal) => Promise<string>;
  character: (input: ConversationProviderInput, signal: AbortSignal) => Promise<string | ConversationProviderResult>;
  reviewer: (input: ReviewerView, index: number, signal: AbortSignal) => Promise<Review>;
};

/** Keep evidence tied to its step while tolerating reviewer line wrapping. */
export function reviewQuoteMatches(message: string, quote: string): boolean {
  const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const candidate = normalize(quote);
  return candidate.length > 0 && normalize(message).includes(candidate);
}

const limitations = ["OFFLINE_FAKE_NOT_LANGUAGE_EVALUATION", "LOCAL_CHARACTER_NOT_PUBLISHED_DB_VERIFICATION", "RELATIONSHIP_GROWTH_UNSUPPORTED", "PERSISTENT_RELATIONSHIP_BOUNDARIES_UNSUPPORTED", "NO_REAL_DATABASE_RLS_VERIFICATION", "ROUTE_TRANSACTION_NOT_EXERCISED"];
const scope = (m: EvaluationManifest) => ({ userId: `eval-${m.runId}-${m.trajectoryId}`, conversationId: `eval-conversation-${m.runId}-${m.trajectoryId}` });
const relationshipStage = (projection: EvaluationRelationshipProjection): EvaluationCheckpoint["turns"][number]["stageBefore"] => projection.state.familiarity;
const relationshipSummary = (projection: EvaluationRelationshipProjection): string | null => {
  const state = projection.state;
  const boundaries = state.boundaries.map((boundary) => `${boundary.scope}:${boundary.target}`).join(", ");
  const summary = [`familiarity=${state.familiarity}`, `romance=${state.userRomanticIntent}`, `proposal=${state.characterProposal}`];
  if (boundaries) summary.push(`boundaries=${boundaries}`);
  return summary.join("; ");
};
const visible = (s: SandboxSnapshot, turns: EvaluationCheckpoint["turns"] = []): VisibleMessage[] => s.messages.filter((m) => m.status !== "withdrawn" && m.content.trim())
  .map((m) => {
    const generationStep = /-generation-(\d+)$/u.exec(m.generationId ?? "");
    const proactiveStep = m.sourceType === "proactive"
      ? turns.find((turn) => turn.kind === "proactive" && turn.at === m.createdAt.toISOString())?.step
      : undefined;
    const step = generationStep ? Number(generationStep[1]) : proactiveStep;
    return { role: m.role, content: m.content, at: m.createdAt.toISOString(), status: m.status,
      ...(step === undefined ? {} : { step }) };
  });

export function restoreCheckpoint(raw: unknown, manifest: EvaluationManifest): EvaluationCheckpoint {
  const p = checkpointSchema.parse(raw);
  if (p.manifestHash !== fingerprint(manifest) || fingerprint(p.manifest) !== p.manifestHash) throw new Error("CHECKPOINT_MISMATCH");
  const sandbox = createConversationSandbox({ ...scope(manifest), now: () => new Date(0), snapshot: p.sandbox as SandboxSnapshot });
  if (p.turns.length !== p.cursor || p.turns.some((turn, i) => turn.step !== i) || p.prefixHashes.length !== p.cursor
    || new Set(p.traces.map((trace) => trace.id)).size !== p.traces.length
    || (p.activeStep !== null && p.activeStep !== p.cursor)
    || ((p.pending || p.partial) && p.activeStep === null)
    || (["paused", "completed"].includes(p.status) && (p.activeStep !== null || p.pending !== null))
    || p.reviews.length > 2) throw new Error("CHECKPOINT_INCONSISTENT");
  let pendingRoles = 0;
  for (const role of participantRoles) {
    if (p.ledger[role].calls > manifest.budget[role].maxCalls || p.ledger[role].reservedTokens > manifest.budget[role].maxReservedTokens) throw new Error("CHECKPOINT_BUDGET_INVALID");
    const pending = p.pending === `${manifest.trajectoryId}-${role}-${p.ledger[role].calls}` ? 1 : 0;
    pendingRoles += pending;
    if (p.ledger[role].calls !== p.traces.filter((trace) => trace.role === role).length + pending
      || p.ledger[role].reservedTokens !== p.ledger[role].calls * (role === "user" && manifest.participants.user === "scripted-user-v2" ? 0 : manifest.budget[role].inputTokensPerCall + manifest.budget[role].outputTokensPerCall)) throw new Error("CHECKPOINT_INCONSISTENT");
  }
  if (p.pending !== null && pendingRoles !== 1) throw new Error("CHECKPOINT_INCONSISTENT");
  const relationship = p.relationship
    ? p.relationship as EvaluationRelationshipProjection
    : createEvaluationRelationshipProjection({ ownerId: scope(manifest).userId });
  return { ...p, sandbox: sandbox.snapshot(), relationship };
}

export function forkCheckpoint(raw: unknown, childManifest: EvaluationManifest, childRoute: EvaluationRoute): EvaluationCheckpoint {
  const parsed = checkpointSchema.parse(raw);
  const parent = restoreCheckpoint(raw, parsed.manifest);
  const child = manifestSchema.parse(childManifest);
  routeSchema.parse(childRoute);
  if (parent.pending || parent.activeStep !== null || parent.status !== "paused") throw new Error("FORK_REQUIRES_SAFE_CHECKPOINT");
  if (child.runId === parent.manifest.runId && child.trajectoryId === parent.manifest.trajectoryId) throw new Error("FORK_REQUIRES_NEW_ID");
  if (child.codeFingerprint !== parent.manifest.codeFingerprint || child.characterHash !== parent.manifest.characterHash || child.routeHash !== fingerprint(childRoute)) throw new Error("FORK_BASELINE_MISMATCH");
  if (childRoute.steps.length < parent.cursor || child.routeId !== parent.manifest.routeId || fingerprint(childRoute.persona) !== parent.personaHash
    || parent.prefixHashes.some((hash, i) => hash !== fingerprint(childRoute.steps[i]))) throw new Error("FORK_ROUTE_MISMATCH");
  const copy = structuredClone(parent);
  copy.parent = { runId: parent.manifest.runId, trajectoryId: parent.manifest.trajectoryId, checkpointHash: fingerprint(parent), cursor: parent.cursor };
  copy.manifest = child; copy.manifestHash = fingerprint(child); copy.elapsedMs = 0;
  const ids = scope(child); copy.sandbox.userId = ids.userId; copy.sandbox.conversationId = ids.conversationId;
  copy.sandbox.memories = copy.sandbox.memories.map((m) => ({ ...m, userId: ids.userId, sourceConversationId: ids.conversationId }));
  copy.sandbox.candidates = copy.sandbox.candidates.map((c) => ({ ...c, userId: ids.userId, conversationId: ids.conversationId }));
  copy.relationship = rebaseEvaluationRelationshipProjection(copy.relationship, { ownerId: ids.userId, identityId: copy.relationship.scope.identityId, epoch: copy.relationship.scope.epoch });
  return restoreCheckpoint(copy, child);
}

/** Real execution requires explicit participants; no provider/DB client is imported here. */
export async function runTrajectory(input: {
  manifest: EvaluationManifest; route: EvaluationRoute; checkpoint?: unknown;
  participants?: Partial<OfflineParticipants>; signal?: AbortSignal;
  persist?: (checkpoint: EvaluationCheckpoint) => Promise<void>;
  stopAfterTurns?: number;
}): Promise<EvaluationCheckpoint> {
  const manifest = manifestSchema.parse(input.manifest);
  if (manifest.mode === "real" && (!input.participants?.user || !input.participants.character || !input.participants.reviewer)) throw new Error("REAL_PARTICIPANTS_REQUIRED");
  const route = routeSchema.parse(input.route);
  if (manifest.routeHash !== fingerprint(route) || manifest.routeId !== route.routeId) throw new Error("ROUTE_MISMATCH");
  const runtime = await resolveConversationCharacter({ characterKey: "lucia", characterVersion: manifest.characterVersion, allowStaticFallback: true });
  const character = runtime.catalog.snapshot;
  if (manifest.characterHash !== fingerprint(character)) throw new Error("CHARACTER_MISMATCH");
  let now = new Date(route.steps[0].at);
  const restored = input.checkpoint ? restoreCheckpoint(input.checkpoint, manifest) : null;
  const sandbox = createConversationSandbox({ ...scope(manifest), now: () => now, ...(restored ? { snapshot: restored.sandbox } : {}) });
  if (!restored) sandbox.open();
  const state: EvaluationCheckpoint = restored ?? {
    formatVersion: 1, manifest, manifestHash: fingerprint(manifest), status: "running", cursor: 0, activeStep: null, pending: null,
    elapsedMs: 0, sandbox: sandbox.snapshot(), prefixHashes: [], personaHash: fingerprint(route.persona), ledger: { user: { calls: 0, reservedTokens: 0 }, character: { calls: 0, reservedTokens: 0 }, reviewer: { calls: 0, reservedTokens: 0 } },
    traces: [], turns: [], reviews: [], relationship: createEvaluationRelationshipProjection({ ownerId: scope(manifest).userId }), limitations: manifest.mode === "fake" ? limitations.filter((item) => !["RELATIONSHIP_GROWTH_UNSUPPORTED", "PERSISTENT_RELATIONSHIP_BOUNDARIES_UNSUPPORTED"].includes(item)) : limitations.filter((item) => !["OFFLINE_FAKE_NOT_LANGUAGE_EVALUATION", "RELATIONSHIP_GROWTH_UNSUPPORTED", "PERSISTENT_RELATIONSHIP_BOUNDARIES_UNSUPPORTED"].includes(item)).concat("SYNTHETIC_USER_NOT_HUMAN_EXPERIENCE", "SAME_MODEL_REVIEW_NOT_INDEPENDENT_HUMAN_VALIDATION"), errorCode: null, partial: null,
  };
  if (state.cursor > route.steps.length) throw new Error("CHECKPOINT_CURSOR_INVALID");
  if (state.personaHash !== fingerprint(route.persona) || state.prefixHashes.some((hash, i) => hash !== fingerprint(route.steps[i]))) throw new Error("CHECKPOINT_INCONSISTENT");
  sandbox.setRelationship(relationshipStage(state.relationship), relationshipSummary(state.relationship));
  state.sandbox = sandbox.snapshot();
  const priorElapsed = state.elapsedMs, started = performance.now();
  let persistenceError: unknown = null;
  const save = async () => {
    state.sandbox = sandbox.snapshot(); state.elapsedMs = priorElapsed + performance.now() - started;
    try { await input.persist?.(redactCheckpointText(state)); }
    catch (error) { persistenceError = error; throw error; }
  };
  if (!["running", "paused"].includes(state.status)) return state;
  if (state.pending || state.activeStep !== null) {
    state.status = "interrupted"; state.errorCode = "AMBIGUOUS_INFLIGHT_CALL_OR_TURN";
    await save(); return state;
  }
  state.status = "running";
  let halt: "cancelled" | "budget_exhausted" | null = null;
  const abort = new AbortController();
  const forwardAbort = () => { halt = "cancelled"; abort.abort(); };
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  if (input.signal?.aborted) forwardAbort();
  const remaining = () => manifest.maxWallMs - priorElapsed - (performance.now() - started);
  const dispatch = async <T>(role: ParticipantRole, view: unknown, work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    if (halt || abort.signal.aborted) throw new Error(halt ?? "cancelled");
    const ledger = state.ledger[role], quota = manifest.budget[role];
    const scriptedUser = role === "user" && manifest.participants.user === "scripted-user-v2";
    const tokens = scriptedUser ? 0 : quota.inputTokensPerCall + quota.outputTokensPerCall;
    if (remaining() <= 0 || ledger.calls >= quota.maxCalls || ledger.reservedTokens + tokens > quota.maxReservedTokens) {
      halt = "budget_exhausted"; throw new Error("BUDGET_EXHAUSTED");
    }
    ledger.calls++; ledger.reservedTokens += tokens;
    const id = `${manifest.trajectoryId}-${role}-${ledger.calls}`;
    state.pending = id;
    await save(); // Durable reservation before any participant invocation.
    const callStart = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let invoked = false;
    try {
      if (remaining() <= 0) { halt = "budget_exhausted"; throw new Error("BUDGET_EXHAUSTED"); }
      if (abort.signal.aborted) throw new Error("CANCELLED");
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("CANCELLED"));
        abort.signal.addEventListener("abort", onAbort, { once: true });
        if (abort.signal.aborted) onAbort();
        timer = setTimeout(() => { halt = "budget_exhausted"; abort.abort(); reject(new Error("WALL_BUDGET_EXHAUSTED")); }, Math.max(1, remaining()));
      });
      const result = await Promise.race([Promise.resolve().then(() => { if (abort.signal.aborted) throw new Error("CANCELLED"); invoked = true; return work(abort.signal); }), cancelled]);
      const context = role === "character" ? view as ConversationProviderInput : undefined;
      const providerResult = role === "character" && result && typeof result === "object" && "text" in result ? result as unknown as ConversationProviderResult : null;
      state.traces.push({ id, role, step: state.cursor, outcome: "returned", invoked, output: redactProviderText(providerResult ? providerResult.text : typeof result === "string" ? result : JSON.stringify(result)), gate: null,
        durationMs: performance.now() - callStart, costMicros: providerResult?.estimatedCostMicros ?? (manifest.mode === "fake" || scriptedUser ? 0 : null), inputHash: fingerprint(view),
        ...(providerResult ? { provider: providerResult.provider, modelVersion: providerResult.modelVersion, providerRequestId: providerResult.providerRequestId } : {}),
        ...(context ? { contextStage: context.relationshipStage, memoryKeys: context.memories.map((m) => m.factKey), recentMessageCount: context.recentMessages.length,
          recentMessageCharacters: context.recentMessages.reduce((sum, m) => sum + m.content.length, 0) } : {}),
      });
      state.pending = null; await save();
      if (remaining() <= 0) { halt = "budget_exhausted"; throw new Error("BUDGET_EXHAUSTED"); }
      if (abort.signal.aborted) throw new Error("CANCELLED");
      return result;
    } catch (error) {
      if (persistenceError) throw persistenceError;
      const existing = state.traces.find((trace) => trace.id === id);
      if (existing) existing.outcome = halt ? "cancelled" : "failed";
      else state.traces.push({ id, role, step: state.cursor, outcome: halt ? "cancelled" : "failed", invoked, output: null, gate: null,
        durationMs: performance.now() - callStart, costMicros: manifest.mode === "fake" ? 0 : null, inputHash: fingerprint(view) });
      state.pending = null; await save(); throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) abort.signal.removeEventListener("abort", onAbort);
    }
  };
  const message = (id: string, role: "user" | "character", content: string, generationId: string, replyToMessageId: string | null, status: ConversationMessageRecord["status"] = "completed"): ConversationMessageRecord => ({
    id, role, content, generationId, replyToMessageId, clientMessageId: id, status, sourceType: "conversation", createdAt: now, completedAt: status === "completed" ? now : null,
  });
  // Execution-local only: old terminal checkpoints and archived report bytes stay unchanged.
  let reviewPhase = false;
  try {
    await save();
    for (; state.cursor < route.steps.length;) {
      if (halt) { state.status = halt; break; }
      if (remaining() <= 0) { state.status = "budget_exhausted"; break; }
      if (input.stopAfterTurns !== undefined && state.turns.length >= input.stopAfterTurns) { state.status = "paused"; break; }
      const step = route.steps[state.cursor]; now = new Date(step.at);
      const generationId = `${manifest.trajectoryId}-generation-${state.cursor}`;
      const before = sandbox.snapshot();
      const stageBefore = relationshipStage(state.relationship);
      state.activeStep = state.cursor; await save();
      const provider = { generate: async (context: ConversationProviderInput): Promise<ConversationProviderResult> => {
        const output = await dispatch("character", context, (signal) => input.participants?.character?.(structuredClone(context), signal) ?? Promise.resolve(step.fakeReply));
        if (typeof output !== "string") return output;
        if (manifest.mode === "real") throw new Error("REAL_PROVIDER_METADATA_REQUIRED");
        return { text: output, provider: "deterministic-fake", modelVersion: "scripted-fake-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0 };
      } };
      let done = false, result = "unknown";
      if (step.kind === "user") {
        const userView: UserView = { persona: route.persona, lifeEvent: step.lifeEvent, session: step.session, transcript: visible(before) };
        const text = z.string().trim().min(1).max(2000).parse(await dispatch("user", userView, (signal) => input.participants?.user?.(structuredClone(userView), signal) ?? Promise.resolve(userView.lifeEvent)));
        const userMessage = message(`${generationId}-user`, "user", text, generationId, null);
        sandbox.appendMessage(userMessage); await save();
        const context = await buildReplyContext({ generationId, userId: before.userId, userMessage: text, character, relationshipStage: relationshipStage(state.relationship), relationshipSummary: relationshipSummary(state.relationship), relationshipSignalsSummary: relationshipSummary(state.relationship),
          recentMessages: before.messages.slice(-100).filter((m) => m.status !== "withdrawn" && m.content.trim()).map((m) => ({ role: m.role, content: m.content, sentAt: m.createdAt.toISOString() })),
          memoryRepository: sandbox.memoryRepository, now });
        let reply = "";
        for await (const event of streamReply({ characterKey: "lucia", characterVersion: manifest.characterVersion, text, clientMessageId: userMessage.id, generationId,
          messageId: `${generationId}-character`, replyContext: context, replyProvider: provider, wait: async () => {}, signal: abort.signal,
          safetyRetryLimit: manifest.safetyRetryLimit ?? 1,
          onBubble: async ({ prefix }) => {
            state.partial = { id: `${generationId}-character`, generationId, content: prefix, at: now.toISOString(), replyTo: userMessage.id };
            await save(); return !abort.signal.aborted;
          },
          onProviderResult: (observation) => {
            const trace = state.traces.findLast((t) => t.role === "character" && t.step === state.cursor && t.gate === null);
            if (trace) trace.gate = observation.errorType ?? observation.status;
          },
        })) {
          if (persistenceError) throw persistenceError;
          if (event.type === "delta") reply += event.text;
          if (event.type === "error") result = event.code;
          if (event.type === "done" && event.generationId === generationId) { done = true; result = "done"; }
        }
        if (persistenceError) throw persistenceError;
        if (done) {
          const assistant = message(`${generationId}-character`, "character", reply, generationId, userMessage.id);
          sandbox.appendMessage(assistant);
          await commitMemories({ repository: sandbox.memoryRepository, completed: true,
            candidates: extractMemories({ userId: before.userId, characterKey: "lucia", characterVersion: manifest.characterVersion, conversationId: before.conversationId,
              turn: { status: "done", userMessage: { id: userMessage.id, role: "user", status: "completed", content: text }, assistantMessage: { id: assistant.id, role: "character", status: "completed", content: reply } } }) });
          state.relationship = admitEvaluationRelationshipTurn(state.relationship, {
            user: { id: userMessage.id, role: "user", sessionId: `session-${step.session}`, episodeId: `episode-${step.session}`, generationId, content: text },
            assistant: { id: assistant.id, role: "assistant", sessionId: `session-${step.session}`, episodeId: `episode-${step.session}`, generationId, content: reply },
          });
          sandbox.setRelationship?.(state.relationship.state.familiarity, relationshipSummary(state.relationship));
        } else if (reply) sandbox.appendMessage(message(`${generationId}-character`, "character", reply, generationId, userMessage.id, "cancelled"));
        state.partial = null;
      } else {
        const generated = await generateLuciaProactiveMessage({ userId: before.userId, source: "daily_share", sourceEventId: generationId, now, repository: sandbox.proactiveRepository,
          provider, character, memories: before.memories });
        if (persistenceError) throw persistenceError;
        done = generated.status === "generated"; result = generated.reason ?? generated.status;
        const attempts = state.traces.filter((t) => t.role === "character" && t.step === state.cursor && t.gate === null);
        for (const [index, trace] of attempts.entries()) trace.gate = index < attempts.length - 1 ? "repeated-question-rejected" : done ? "generated-final-candidate" : result;
      }
      const stageAfter = relationshipStage(state.relationship);
      state.turns.push({ step: state.cursor, session: step.session, at: step.at, kind: step.kind, generationId, done, result,
        memoryCountBefore: before.memories.length, memoryCountAfter: sandbox.snapshot().memories.length, stageBefore, stageAfter });
      state.prefixHashes.push(fingerprint(step)); state.cursor++; state.activeStep = null;
      // Proactive messages are an optional opportunity, not the user's active
      // reply. A transient provider/safety failure must remain visible in the
      // turn record without discarding the rest of the longitudinal route or
      // preventing structural review. User-turn failures and budget/cancel
      // failures remain terminal.
      const nonFatalProactiveFailure = step.kind === "proactive"
        && !done
        && result !== "cancelled"
        && result !== "budget_exhausted";
      if (!done && !nonFatalProactiveFailure && result !== "cooldown" && result !== "daily-limit" && result !== "weekly-limit") {
        state.status = halt ?? "failed"; state.errorCode = result;
      }
      await save();
      if (state.status !== "running") break;
    }
    if (state.status === "running") {
      reviewPhase = true;
      const reviewerView: ReviewerView = { expectedOutcome: route.expectedOutcome, mustAvoid: route.mustAvoid, transcript: visible(sandbox.snapshot(), state.turns), turns: structuredClone(state.turns), limitations: [...state.limitations] };
      for (let index = state.reviews.length; index < 2; index++) {
        state.activeStep = state.cursor; await save();
        const review = await dispatch("reviewer", reviewerView, (signal) => input.participants?.reviewer?.(structuredClone(reviewerView), index, signal) ?? Promise.resolve({
          reviewer: `fake-structural-${index + 1}`, verdict: "not_evaluated" as const, notes: "仅检查执行与证据结构；fake 不评价自然西语、人格或关系发展。", evidenceSteps: state.turns.map((t) => t.step),
        }));
        const parsedReview = reviewSchema.parse(review);
        if (parsedReview.evidenceSteps.some((s) => !state.turns.some((t) => t.step === s)) || parsedReview.findings?.some((finding) =>
          !state.turns.some((t) => t.step === finding.step) || !reviewerView.transcript.some((m) => m.step === finding.step && reviewQuoteMatches(m.content, finding.quote)))) throw new Error("REVIEW_EVIDENCE_INVALID");
        state.reviews.push(parsedReview); state.activeStep = null; await save();
      }
      state.status = "completed";
    }
  } catch (error) {
    if (persistenceError) throw persistenceError;
    // Abort handlers can update halt while awaiting participant work.
    const reason = halt as "cancelled" | "budget_exhausted" | null;
    state.status = reason ?? "failed";
    state.errorCode ??= reason ? reason.toUpperCase()
      : reviewPhase ? error instanceof Error && error.message === "REVIEW_EVIDENCE_INVALID" ? "REVIEW_EVIDENCE_INVALID" : "REVIEW_FAILED"
        : "PARTICIPANT_OR_APPLICATION_FAILED";
    // Do not auto-retry an uncertain step. Partial delivery remains visible and cannot create memory.
    if (state.partial) {
      const p = state.partial;
      sandbox.appendMessage({ ...message(p.id, "character", p.content, p.generationId, p.replyTo, "cancelled"), createdAt: new Date(p.at) });
      state.partial = null;
    }
    state.activeStep = null;
  } finally {
    input.signal?.removeEventListener("abort", forwardAbort);
  }
  await save();
  return state;
}
