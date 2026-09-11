import { describe, expect, it } from "vitest";

import {
  getScenarioPracticeDetail,
  listScenarioPracticeDetails,
} from "@/src/modules/scenario-practice/content";

describe("scenario practice content", () => {
  it("provides three content-driven starter scenarios", () => {
    const scenarios = listScenarioPracticeDetails();

    expect(scenarios.map((scenario) => scenario.stableKey)).toEqual([
      "scenario.restaurant-ordering",
      "scenario.campus-administration",
      "scenario.rental-conversation",
    ]);
    expect(new Set(scenarios.map((scenario) => scenario.temporaryCharacter.role)).size).toBe(3);

    for (const scenario of scenarios) {
      expect(scenario.tasks).toHaveLength(3);
      expect(scenario.expressions.length).toBeGreaterThanOrEqual(5);
      expect(scenario.conditions).toHaveLength(1);
      expect(scenario.conditions[0]?.afterUserTurns).toBeGreaterThan(0);
      expect(scenario.tasks.every((task) => (
        task.hints.level1.length > 0 &&
        task.hints.level2.length > 0 &&
        task.hints.level3.length > 0
      ))).toBe(true);
    }
  });

  it("keeps the rental scenario explicitly fictional", () => {
    const scenario = getScenarioPracticeDetail("scenario.rental-conversation");

    expect(scenario?.fictionalContext).toBe(true);
    expect(scenario?.description).toContain("虚构");
  });

  it("returns null for an unknown scenario", () => {
    expect(getScenarioPracticeDetail("scenario.unknown")).toBeNull();
  });
});
