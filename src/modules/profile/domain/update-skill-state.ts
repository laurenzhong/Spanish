import type { EvidenceEventDraft } from "@/src/modules/evidence/domain";

export type SkillStateSnapshot = Readonly<{
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  mastery: number;
  skillKey: string;
  snapshotVersion: number;
  userId: string;
}>;

export type SkillEvidence = Pick<
  EvidenceEventDraft,
  "confidence" | "evidenceWeight" | "occurredAt" | "outcomeScore"
>;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function initialState(userId: string, skillKey: string): SkillStateSnapshot {
  return {
    confidence: 0,
    evidenceCount: 0,
    lastEvidenceAt: null,
    mastery: 0,
    skillKey,
    snapshotVersion: 1,
    userId,
  };
}

export function applyEvidenceToSkillState(
  current: SkillStateSnapshot,
  evidence: SkillEvidence,
): SkillStateSnapshot {
  const confidenceGain = evidence.evidenceWeight * evidence.confidence;
  return {
    ...current,
    confidence: clamp(
      current.confidence + confidenceGain * (1 - current.confidence),
    ),
    evidenceCount: current.evidenceCount + 1,
    lastEvidenceAt:
      current.lastEvidenceAt && current.lastEvidenceAt > evidence.occurredAt
        ? current.lastEvidenceAt
        : evidence.occurredAt,
    mastery: clamp(
      current.mastery +
        evidence.evidenceWeight * (evidence.outcomeScore - current.mastery),
    ),
  };
}

export function rebuildSkillState(
  userId: string,
  skillKey: string,
  evidence: readonly SkillEvidence[],
): SkillStateSnapshot {
  return evidence.reduce(
    (state, item) => applyEvidenceToSkillState(state, item),
    initialState(userId, skillKey),
  );
}
