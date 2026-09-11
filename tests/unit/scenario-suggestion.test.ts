import { describe, expect, it } from "vitest";

import {
  suggestScenario,
  type ScenarioSuggestionCandidate,
  type ScenarioSuggestionContext,
} from "@/src/modules/explore/domain/scenario-suggestion";

const baseContext: ScenarioSuggestionContext = {
  cefr: "A2",
  savedExpressionTexts: [],
  reliableGapGoalKeys: [],
  practicedScenarioKeys: [],
  practicedCategories: [],
  practicedGoalKeys: [],
  recentScenarioKeys: [],
  activeScenarioKeys: [],
};

function candidate(
  stableKey: string,
  patch: Partial<ScenarioSuggestionCandidate> = {},
): ScenarioSuggestionCandidate {
  return {
    stableKey,
    title: stableKey,
    description: `练习 ${stableKey}`,
    cefr: "A2",
    category: "daily-life",
    categoryLabel: "日常生活",
    role: "临时对话者",
    communicationGoal: "完成一次请求",
    goalKeys: ["communication.need.ask-help"],
    expressionTexts: ["¿Puede ayudarme?"],
    modalities: ["speech", "typing"],
    sourceKind: "public",
    status: "published",
    route: `/explore/scenarios/${stableKey}`,
    ...patch,
  };
}

describe("scenario suggestion strategy", () => {
  it("prefers a level-safe scenario that reuses a saved expression", () => {
    const result = suggestScenario({
      mode: "best_fit",
      candidates: [
        candidate("plain"),
        candidate("saved", { expressionTexts: ["¿Me lo puede repetir?"] }),
      ],
      context: { ...baseContext, savedExpressionTexts: ["¿Me lo puede repetir?"] },
      excludedScenarioIds: [],
      random: () => 0,
    });

    expect(result.scenario?.stableKey).toBe("saved");
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "saved-expression",
      "level-match",
    ]);
  });

  it("uses unseen categories and goals for discovery", () => {
    const result = suggestScenario({
      mode: "discover",
      candidates: [
        candidate("familiar"),
        candidate("new", {
          category: "health",
          categoryLabel: "医疗沟通",
          goalKeys: ["communication.health.describe-symptom"],
          communicationGoal: "说明身体不适",
        }),
      ],
      context: {
        ...baseContext,
        practicedCategories: ["daily-life"],
        practicedGoalKeys: ["communication.need.ask-help"],
      },
      excludedScenarioIds: [],
      random: () => 0,
    });

    expect(result.scenario?.stableKey).toBe("new");
    expect(result.reasons.map((reason) => reason.code)).toEqual([
      "new-category",
      "new-goal",
    ]);
  });

  it("randomizes only inside the eligible, difficulty-safe pool", () => {
    const input = {
      mode: "random" as const,
      candidates: [
        candidate("published-a"),
        candidate("published-b", { category: "study" }),
        candidate("draft", { status: "draft" }),
        candidate("too-hard", { cefr: "C1" }),
        candidate("active"),
      ],
      context: { ...baseContext, activeScenarioKeys: ["active"] },
      excludedScenarioIds: [] as readonly string[],
    };

    const first = suggestScenario({ ...input, random: () => 0.72 });
    const second = suggestScenario({ ...input, random: () => 0.72 });

    expect(first).toEqual(second);
    expect(["published-a", "published-b"]).toContain(first.scenario?.stableKey);
    expect(first.eligibleCount).toBe(2);
  });

  it("does not repeat excluded scenarios and stops after five displayed results", () => {
    const candidates = Array.from({ length: 7 }, (_, index) => candidate(`scenario-${index + 1}`));
    const result = suggestScenario({
      mode: "best_fit",
      candidates,
      context: baseContext,
      excludedScenarioIds: ["scenario-1", "scenario-2"],
      random: () => 0,
    });
    const exhausted = suggestScenario({
      mode: "best_fit",
      candidates,
      context: baseContext,
      excludedScenarioIds: ["scenario-1", "scenario-2", "scenario-3", "scenario-4", "scenario-5"],
      random: () => 0,
    });

    expect(result.scenario?.stableKey).toBe("scenario-3");
    expect(exhausted).toMatchObject({ scenario: null, canSwap: false, limitReached: true });
  });

  it("falls back honestly when there is no profile or eligible scenario", () => {
    const noProfile = suggestScenario({
      mode: "best_fit",
      candidates: [candidate("starter", { cefr: "B1" })],
      context: { ...baseContext, cefr: null },
      excludedScenarioIds: [],
      random: () => 0,
    });
    const empty = suggestScenario({
      mode: "best_fit",
      candidates: [candidate("draft", { status: "draft" })],
      context: baseContext,
      excludedScenarioIds: [],
      random: () => 0,
    });

    expect(noProfile.reasons[0]).toMatchObject({ code: "safe-start" });
    expect(empty).toMatchObject({ scenario: null, eligibleCount: 0, limitReached: false });
  });
});
