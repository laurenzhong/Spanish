import {
  evaluateAttempt,
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

export type RecordEvidenceResult = Readonly<{
  events: readonly PersistedEvidenceEvent[];
  skillStates: readonly SkillStateSnapshot[];
  status: "duplicate" | "ignored" | "recorded";
  reason?: string;
}>;

export async function recordEvidence(
  repository: EvidenceRepository,
  input: unknown,
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

  return repository.transaction(async (transaction) => {
    const firstEvent = evaluation.events[0]!;
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
      status: missing.length === 0 ? "duplicate" : "recorded",
    };
  });
}
