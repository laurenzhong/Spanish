import { describe, expect, it } from "vitest";

import {
  completeDiagnosticTask,
  startInitialDiagnostic,
  type DiagnosticScenario,
} from "@/src/modules/diagnostic";
import type { EvidenceEventDraft } from "@/src/modules/evidence/domain";
import type { EvidenceRepository } from "@/src/modules/evidence";
import type { SkillStateSnapshot } from "@/src/modules/profile/domain";

const userId = "00000000-0000-4000-8000-000000000101";
const attemptId = "00000000-0000-4000-8000-000000000102";

const scenario: DiagnosticScenario = {
  stableKey: "diagnostic.application",
  version: 1,
  status: "published",
  tasks: [0, 1, 2].map((position) => ({
    goalKey: `goal-${position}`,
    position,
    prompt: `Prompt ${position}`,
    targetExpressionKeys: [`expression-${position}`],
  })),
};

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    algorithmVersion: "evidence-v1",
    contentVersion: 1,
    contextualSuccess: true,
    evaluationConfidence: 0.95,
    evidenceStrength: "strong",
    hasUsableTranscript: true,
    hintLevel: 0,
    idempotencyKey: "diagnostic-attempt-1",
    modality: "speech",
    occurredAt: new Date("2026-08-23T12:00:00.000Z"),
    practiceAttemptId: attemptId,
    skillObservations: [{ isTargetSkill: false, skillKey: "task.start", tagWeight: 1 }],
    taskDifficulty: 0.5,
    targetExpressionUsed: true,
    technicalFailure: false,
    transcriptConfidence: 0.96,
    userId,
    ...overrides,
  };
}

function repository(): EvidenceRepository {
  const events: EvidenceEventDraft[] = [];
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
    async upsertSkillState(_state: SkillStateSnapshot) {
      // The fake only needs to prove that recordEvidence owns snapshot updates.
      void _state;
    },
  };
  return repo;
}

describe("initial diagnostic application", () => {
  it("delegates valid speech evidence and advances one task", async () => {
    const session = startInitialDiagnostic(scenario);
    const result = await completeDiagnosticTask(repository(), {
      plan: session.plan,
      progress: session.progress,
      taskId: session.plan.tasks[0]!.id,
      inputMode: "speech",
      evaluation: evaluation(),
    });

    expect(result.advanced).toBe(true);
    expect(result.evidence.status).toBe("recorded");
    expect(result.progress).toMatchObject({
      completedTaskCount: 1,
      currentTaskIndex: 1,
      lastInputMode: "speech",
    });
  });

  it("does not advance when low-confidence speech is ignored", async () => {
    const session = startInitialDiagnostic(scenario);
    const result = await completeDiagnosticTask(repository(), {
      plan: session.plan,
      progress: session.progress,
      taskId: session.plan.tasks[0]!.id,
      inputMode: "speech",
      evaluation: evaluation({ transcriptConfidence: 0.1 }),
    });

    expect(result.advanced).toBe(false);
    expect(result.evidence.status).toBe("ignored");
    expect(result.progress).toBe(session.progress);
  });

  it("does not advance when a technical failure is reported", async () => {
    const session = startInitialDiagnostic(scenario);
    const result = await completeDiagnosticTask(repository(), {
      plan: session.plan,
      progress: session.progress,
      taskId: session.plan.tasks[0]!.id,
      inputMode: "speech",
      evaluation: evaluation({ technicalFailure: true }),
    });

    expect(result.advanced).toBe(false);
    expect(result.evidence).toMatchObject({
      status: "ignored",
      reason: "technical-failure",
    });
    expect(result.progress).toBe(session.progress);
  });

  it("keeps typing as an explicit fallback while evidence rules exclude oral skills", async () => {
    const session = startInitialDiagnostic(scenario);
    const result = await completeDiagnosticTask(repository(), {
      plan: session.plan,
      progress: session.progress,
      taskId: session.plan.tasks[0]!.id,
      inputMode: "typing",
      evaluation: evaluation({
        idempotencyKey: "diagnostic-typing-1",
        modality: "typing",
        transcriptConfidence: null,
        skillObservations: [
          { isTargetSkill: false, skillKey: "task.start", tagWeight: 0.8 },
          { isTargetSkill: false, skillKey: "fluency.turn-taking", tagWeight: 0.2 },
        ],
      }),
    });

    expect(result.advanced).toBe(true);
    expect(result.evidence.events.map((event) => event.skillKey)).toEqual(["task.start"]);
    expect(result.progress.lastInputMode).toBe("typing");
  });

  it("does not call evidence for an out-of-order task", async () => {
    const session = startInitialDiagnostic(scenario);
    const result = await completeDiagnosticTask(repository(), {
      plan: session.plan,
      progress: session.progress,
      taskId: session.plan.tasks[1]!.id,
      inputMode: "speech",
      evaluation: evaluation(),
    });

    expect(result).toMatchObject({
      advanced: false,
      evidence: { status: "ignored", reason: "task-out-of-order" },
    });
  });
});
