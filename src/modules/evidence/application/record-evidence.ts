import {
  evaluateAttempt,
  type EvidenceEventDraft,
} from "../domain";
import {
  EvidenceOwnershipError,
  type EvidenceRepository,
  type PersistedEvidenceEvent,
} from "../repositories/evidence-repository";
import {
  rebuildSkillState,
  type SkillStateSnapshot,
} from "@/src/modules/profile/domain";
import {
  recordDiagnosticEventSafely,
  type DiagnosticEventWriter,
} from "@/src/shared/observability";

export type RecordEvidenceResult = Readonly<{
  events: readonly PersistedEvidenceEvent[];
  skillStates: readonly SkillStateSnapshot[];
  status: "duplicate" | "ignored" | "recorded";
  reason?: string;
}>;

export async function recordEvidence(
  repository: EvidenceRepository,
  input: unknown,
  options: Readonly<{ diagnostics?: DiagnosticEventWriter; requestId?: string }> = {},
): Promise<RecordEvidenceResult> {
  const evaluation = evaluateAttempt(input);
  if (evaluation.status === "ignored") {
    return {
      events: [],
      skillStates: [],
      status: "ignored",
      reason: evaluation.reason,
    };
  }

  const result = await repository.transaction(async (transaction) => {
    const firstEvent = evaluation.events[0]!;
    if (!firstEvent.practiceAttemptId) throw new EvidenceOwnershipError();
    const ownsAttempt = await transaction.assertPracticeAttemptBelongsToUser(
      firstEvent.userId,
      firstEvent.practiceAttemptId,
    );
    if (!ownsAttempt) throw new EvidenceOwnershipError();

    const keys = evaluation.events.map((event) => event.idempotencyKey);
    const existing = await transaction.findByIdempotencyKeys(
      firstEvent.userId,
      keys,
    );
    const existingKeys = new Set(
      existing.map((event) => event.idempotencyKey),
    );
    const missing = evaluation.events.filter(
      (event) => !existingKeys.has(event.idempotencyKey),
    );
    if (missing.length > 0) await transaction.append(missing);

    const persisted = await transaction.findByIdempotencyKeys(
      firstEvent.userId,
      keys,
    );
    const skillStates: SkillStateSnapshot[] = [];
    for (const skillKey of new Set(evaluation.events.map((event) => event.skillKey))) {
      const skillEvidence = await transaction.listBySkill(
        firstEvent.userId,
        skillKey,
      );
      const state = rebuildSkillState(
        firstEvent.userId,
        skillKey,
        skillEvidence,
      );
      await transaction.upsertSkillState(state);
      skillStates.push(state);
    }

    return {
      events: persisted,
      skillStates,
      status: missing.length === 0 ? ("duplicate" as const) : ("recorded" as const),
      firstEvent,
      missingCount: missing.length,
    };
  });

  if (result.status === "duplicate") {
    await recordDiagnosticEventSafely(options.diagnostics, {
      userId: result.firstEvent.userId,
      eventType: "evidence.duplicate",
      severity: "warning",
      dedupeKey: `evidence-duplicate:${result.firstEvent.userId}:${result.firstEvent.idempotencyKey}`,
      correlation: {
        requestId: options.requestId,
        attemptId: result.firstEvent.practiceAttemptId ?? undefined,
      },
      metadata: { eventCount: result.events.length, missingCount: result.missingCount },
    });
  }

  return {
    events: result.events,
    skillStates: result.skillStates,
    status: result.status,
  };
}

export type RecordLexicalEvidenceInput = Readonly<{
  event: EvidenceEventDraft;
}>;

export type RecordLexicalEvidenceResult = Omit<RecordEvidenceResult, "status"> & Readonly<{
  status: "duplicate" | "recorded";
}>;

export async function recordLexicalEvidenceWithinTransaction(
  repository: EvidenceRepository,
  input: RecordLexicalEvidenceInput,
): Promise<RecordLexicalEvidenceResult> {
  if (input.event.sourceType !== "lexical_assessment" || input.event.practiceAttemptId !== null) {
    throw new Error("LEXICAL_EVIDENCE_SOURCE_INVALID");
  }
  const existing = await repository.findByIdempotencyKeys(input.event.userId, [input.event.idempotencyKey]);
  if (existing.length === 0) await repository.append([input.event]);
  const persisted = await repository.findByIdempotencyKeys(input.event.userId, [input.event.idempotencyKey]);
  const skillEvidence = await repository.listBySkill(input.event.userId, input.event.skillKey);
  const state = rebuildSkillState(input.event.userId, input.event.skillKey, skillEvidence);
  await repository.upsertSkillState(state);
  return { events: persisted, skillStates: [state], status: existing.length > 0 ? "duplicate" : "recorded" };
}

export async function recordLexicalEvidence(
  repository: EvidenceRepository,
  input: RecordLexicalEvidenceInput,
): Promise<RecordLexicalEvidenceResult> {
  return repository.transaction((transaction) => recordLexicalEvidenceWithinTransaction(transaction, input));
}
