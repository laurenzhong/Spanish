import { describe, expect, it } from "vitest";

import {
  getScenarioPracticeDetail,
  listScenarioPracticeDetails,
} from "@/src/modules/scenario-practice/content";

describe("scenario practice content", () => {
  it("provides a growing content-driven starter catalog", () => {
    const scenarios = listScenarioPracticeDetails();

    expect(scenarios.map((scenario) => scenario.stableKey)).toEqual([
      "scenario.restaurant-ordering",
      "scenario.campus-administration",
      "scenario.rental-conversation",
      "scenario.restaurant-takeaway",
      "scenario.campus-student-card",
      "scenario.rental-viewing",
      "scenario.transport-ticket",
      "scenario.post-office",
      "scenario.hotel-checkin",
    ]);
    expect(new Set(scenarios.map((scenario) => scenario.temporaryCharacter.role)).size).toBe(6);

    for (const scenario of scenarios) {
      expect(scenario.version).toBeGreaterThan(0);
      expect(scenario.status).toBe("published");
      expect(scenario.tasks).toHaveLength(3);
      expect(scenario.expressions.length).toBeGreaterThanOrEqual(3);
      expect(scenario.conditions).toHaveLength(1);
      expect(scenario.conditions[0]?.afterUserTurns).toBeGreaterThan(0);
      expect(scenario.tasks.every((task) => task.targetExpressionKeys.length > 0)).toBe(true);
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
    expect(
      scenario?.expressions.find(
        (expression) => expression.stableKey === "rental.otra-hora",
      )?.text,
    ).toBe("¿Podríamos ver el piso a otra hora?");
  });

  it("keeps the new travel and service scenarios fictional and categorized", () => {
    for (const stableKey of [
      "scenario.transport-ticket",
      "scenario.post-office",
      "scenario.hotel-checkin",
    ]) {
      const scenario = getScenarioPracticeDetail(stableKey);
      expect(scenario?.fictionalContext).toBe(true);
      expect(scenario?.description).toContain("完全虚构");
      expect(scenario?.openingLine).toContain("ejercicio ficticio");
    }
  });

  it("returns null for an unknown scenario", () => {
    expect(getScenarioPracticeDetail("scenario.unknown")).toBeNull();
  });
});
