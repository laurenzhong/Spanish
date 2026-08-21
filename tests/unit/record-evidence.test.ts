import { describe, expect, it } from "vitest";

import {
  recordEvidence,
  type EvidenceRepository,
} from "@/src/modules/evidence";
import type { EvidenceEventDraft } from "@/src/modules/evidence/domain";
import type { SkillStateSnapshot } from "@/src/modules/profile/domain";

const userId = "00000000-0000-4000-8000-000000000011";
const attemptId = "00000000-0000-4000-8000-000000000012";

function input() {
  return {
    algorithmVersion: "evidence-v1",
    contentVersion: 1,
    contextualSuccess: true,
    evaluationConfidence: 0.95,
    evidenceStrength: "strong",
    hasUsableTranscript: true,
    hintLevel: 0,
    idempotencyKey: "attempt-1",
    modality: "speech",
    occurredAt: new Date("2026-08-21T12:00:00.000Z"),
    practiceAttemptId: attemptId,
    skillObservations: [
      { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
    ],
    taskDifficulty: 0.8,
    targetExpressionUsed: true,
    technicalFailure: false,
    transcriptConfidence: 0.96,
    userId,
  };
}

function repository(): EvidenceRepository {
  const events: EvidenceEventDraft[] = [];
  const states = new Map<string, SkillStateSnapshot>();
  const repo: EvidenceRepository = {
    async append(incoming) {
      events.push(...incoming);
    },
    async assertPracticeAttemptBelongsToUser(owner, attempt) {
      return owner === userId && attempt === attemptId;
    },
    async findByIdempotencyKeys(owner, keys) {
      return events.filter(
        (event) => event.userId === owner && keys.includes(event.idempotencyKey),
      );
    },
    async listBySkill(owner, skillKey) {
      return events.filter(
        (event) => event.userId === owner && event.skillKey === skillKey,
      );
    },
    async transaction(work) {
      return work(repo);
    },
    async upsertSkillState(state) {
      states.set(`${state.userId}:${state.skillKey}`, state);
    },
  };
  return repo;
}

describe("recordEvidence", () => {
  it("writes one event and rebuilds a separate skill snapshot", async () => {
    const store = repository();

    const result = await recordEvidence(store, input());

    expect(result.status).toBe("recorded");
    expect(result.events).toHaveLength(1);
    expect(result.skillStates[0]).toMatchObject({
      confidence: expect.any(Number),
      evidenceCount: 1,
      mastery: expect.any(Number),
      skillKey: "task.start",
      userId,
    });
    expect(result.skillStates[0]!.mastery).toBeGreaterThan(0);
    expect(result.skillStates[0]!.confidence).toBeGreaterThan(0);
  });

  it("treats a retry as a duplicate without increasing evidence count", async () => {
    const store = repository();

    const first = await recordEvidence(store, input());
    const second = await recordEvidence(store, input());

    expect(first.status).toBe("recorded");
    expect(second.status).toBe("duplicate");
    expect(second.skillStates[0]!.evidenceCount).toBe(1);
  });

  it("records a reliable contextual miss without treating it as a technical failure", async () => {
    const store = repository();

    const result = await recordEvidence(store, {
      ...input(),
      contextualSuccess: false,
      idempotencyKey: "attempt-miss",
      skillObservations: [
        { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
      ],
    });

    expect(result.status).toBe("recorded");
    expect(result.events[0]?.outcomeScore).toBe(0);
    expect(result.skillStates[0]?.mastery).toBe(0);
    expect(result.skillStates[0]?.confidence).toBeGreaterThan(0);
  });

  it("rejects an attempt owned by another user", async () => {
    const store = repository();

    await expect(
      recordEvidence(store, {
        ...input(),
        practiceAttemptId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toThrow("does not belong");
  });
});
