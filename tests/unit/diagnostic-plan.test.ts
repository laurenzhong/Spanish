import { describe, expect, it } from "vitest";

import {
  createDiagnosticPlan,
  DiagnosticPlanError,
  type DiagnosticScenario,
} from "@/src/modules/diagnostic";

function scenario(overrides: Partial<DiagnosticScenario> = {}): DiagnosticScenario {
  return {
    stableKey: "diagnostic.first-conversation",
    version: 1,
    status: "published",
    tasks: [0, 1, 2, 3, 4].map((position) => ({
      goalKey: `communication.goal-${position}`,
      position,
      prompt: `Prompt ${position}`,
      targetExpressionKeys: [`expression-${position}`],
    })),
    ...overrides,
  };
}

describe("createDiagnosticPlan", () => {
  it("creates a stable five-task plan from a published scenario", () => {
    const plan = createDiagnosticPlan({
      ...scenario(),
      tasks: [...scenario().tasks].reverse(),
    });

    expect(plan).toMatchObject({
      id: "diagnostic.first-conversation@1",
      contentVersion: 1,
      scenarioKey: "diagnostic.first-conversation",
    });
    expect(plan.tasks.map((task) => task.id)).toEqual([
      "diagnostic.first-conversation@1:0",
      "diagnostic.first-conversation@1:1",
      "diagnostic.first-conversation@1:2",
      "diagnostic.first-conversation@1:3",
      "diagnostic.first-conversation@1:4",
    ]);
  });

  it.each([
    ["scenario-not-published", { status: "draft" as const }],
    ["task-count-invalid", { tasks: scenario().tasks.slice(0, 2) }],
    ["task-count-invalid", { tasks: [...scenario().tasks, { ...scenario().tasks[0]!, position: 5 }] }],
    ["task-position-invalid", { tasks: scenario().tasks.map((task, index) => ({ ...task, position: index + 1 })) }],
    ["task-key-invalid", { tasks: scenario().tasks.map((task, index) => index === 2 ? { ...task, prompt: "" } : task) }],
  ] as const)("rejects an invalid scenario with %s", (code, overrides) => {
    expect(() => createDiagnosticPlan(scenario(overrides))).toThrowError(
      expect.objectContaining<Partial<DiagnosticPlanError>>({ code }),
    );
  });
});
