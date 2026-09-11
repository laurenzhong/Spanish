import { describe, expect, it } from "vitest";

import {
  getNextAction,
  getLearningPrimaryAction,
  rankRecommendationCandidates,
  type RecommendationCandidate,
  type RecommendationContext,
} from "@/src/modules/recommendation";

const baseCandidate: RecommendationCandidate = {
  id: "practice.greeting",
  contentKey: "greeting",
  title: "打招呼并开启对话",
  skillKeys: ["task.greeting"],
  supportedInputModes: ["speech", "typing"],
  lastPracticedAt: null,
  recentAttemptCount: 0,
};

function context(
  overrides: Partial<RecommendationContext> = {},
): RecommendationContext {
  return {
    profileStatus: "available",
    coreGoalSkillKeys: [],
    historicalWeakSkillKeys: [],
    recentConversationSkillKeys: [],
    skillSignals: [],
    availableInputModes: ["speech", "typing"],
    candidates: [baseCandidate],
    fallback: {
      id: "practice.basics",
      contentKey: "basics",
      title: "完成一个基础口语任务",
      supportedInputModes: ["speech", "typing"],
    },
    now: "2026-08-23T12:00:00.000Z",
    ...overrides,
  };
}

describe("recommendation ranking", () => {
  it("prioritizes a candidate that closes the current core goal gap", () => {
    const result = rankRecommendationCandidates(
      context({
        coreGoalSkillKeys: ["task.greeting"],
        skillSignals: [{
          skillKey: "task.greeting",
          mastery: 0.2,
          confidence: 0.8,
          oralCoverage: 1,
        }],
      }),
    );

    expect(result[0]).toMatchObject({
      candidate: { id: "practice.greeting" },
      reason: "core-goal-gap",
    });
  });

  it("prioritizes missing oral coverage when speech is available", () => {
    const oralCandidate = { ...baseCandidate, id: "practice.oral", skillKeys: ["task.oral"] };
    const typingCandidate = {
      ...baseCandidate,
      id: "practice.typing",
      skillKeys: ["task.strong"],
      supportedInputModes: ["typing"] as const,
    };
    const result = rankRecommendationCandidates(
      context({
        candidates: [typingCandidate, oralCandidate],
        skillSignals: [
          { skillKey: "task.oral", mastery: 0.8, confidence: 0.8, oralCoverage: null },
          { skillKey: "task.strong", mastery: 0.2, confidence: 0.8, oralCoverage: 0.8 },
        ],
      }),
    );

    expect(result[0]).toMatchObject({
      candidate: { id: "practice.oral" },
      inputMode: "speech",
      reason: "oral-coverage-gap",
    });
  });

  it("filters candidates that require an unavailable input mode", () => {
    const result = rankRecommendationCandidates(
      context({
        availableInputModes: ["typing"],
        candidates: [{ ...baseCandidate, supportedInputModes: ["speech"] }],
      }),
    );

    expect(result).toEqual([]);
  });

  it("penalizes recent repetition and uses a stable id tie-breaker", () => {
    const candidates = [
      { ...baseCandidate, id: "practice.z", recentAttemptCount: 0 },
      { ...baseCandidate, id: "practice.a", recentAttemptCount: 0 },
      { ...baseCandidate, id: "practice.repeated", recentAttemptCount: 3 },
    ];
    const result = rankRecommendationCandidates(context({ candidates }));

    expect(result.map((item) => item.candidate.id)).toEqual([
      "practice.a",
      "practice.z",
      "practice.repeated",
    ]);
  });
});

describe("getNextAction", () => {
  it("returns one safe fallback when profile data is insufficient", () => {
    const result = getNextAction(context({ profileStatus: "insufficient" }));

    expect(result).toMatchObject({
      candidateId: "practice.basics",
      reason: "fallback",
      isFallback: true,
      inputMode: "speech",
    });
    expect(result.explanation).toContain("画像还在建立");
  });

  it("returns the fallback when no eligible candidate remains", () => {
    const result = getNextAction(context({
      availableInputModes: ["typing"],
      candidates: [{ ...baseCandidate, supportedInputModes: ["speech"] }],
    }));

    expect(result).toMatchObject({
      candidateId: "practice.basics",
      isFallback: true,
      inputMode: "typing",
    });
  });
});

describe("getLearningPrimaryAction", () => {
  const due = { id: "repetition-1", goalSnapshot: "在新条件下确认材料", dueAt: "2026-09-11T08:00:00.000Z" };

  it("keeps a stable breakpoint ahead of a due repetition", () => {
    expect(getLearningPrimaryAction({ hasStableBreakpoint: true, dueRepetition: due })).toMatchObject({ kind: "resume", label: "继续学习", href: "/learn/practice" });
  });

  it("selects a due repetition when no stable breakpoint exists", () => {
    expect(getLearningPrimaryAction({ hasStableBreakpoint: false, dueRepetition: due })).toEqual({
      kind: "due-repetition", label: "开始到期复现", title: "在新条件下确认材料",
      reason: "这项场景已经到期；现在换一个条件复现，能验证是否真正迁移。",
      href: "/learn/repetitions/repetition-1",
    });
  });
});
