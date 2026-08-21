import type { EvidenceEventDraft } from "../domain";
import type { SkillStateSnapshot } from "@/src/modules/profile/domain";

export type PersistedEvidenceEvent = Readonly<{
  algorithmVersion: string;
  confidence: number;
  contentVersion: number;
  evidenceWeight: number;
  idempotencyKey: string;
  modality: "listening" | "reading" | "speech" | "typing";
  occurredAt: Date;
  outcomeScore: number;
  practiceAttemptId: string | null;
  skillKey: string;
  sourceReference: Record<string, unknown>;
  sourceType: string;
  userId: string;
}>;

export class EvidenceOwnershipError extends Error {
  constructor() {
    super("Practice attempt does not belong to the current user.");
    this.name = "EvidenceOwnershipError";
  }
}

export type EvidenceRepository = Readonly<{
  assertPracticeAttemptBelongsToUser(
    userId: string,
    practiceAttemptId: string,
  ): Promise<boolean>;
  append(events: readonly EvidenceEventDraft[]): Promise<void>;
  findByIdempotencyKeys(
    userId: string,
    idempotencyKeys: readonly string[],
  ): Promise<readonly PersistedEvidenceEvent[]>;
  listBySkill(
    userId: string,
    skillKey: string,
  ): Promise<readonly PersistedEvidenceEvent[]>;
  transaction<T>(work: (repository: EvidenceRepository) => Promise<T>): Promise<T>;
  upsertSkillState(state: SkillStateSnapshot): Promise<void>;
}>;
