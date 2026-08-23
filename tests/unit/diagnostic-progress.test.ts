import { describe, expect, it } from "vitest";

import {
  advanceDiagnosticProgress,
  createDiagnosticPlan,
  createDiagnosticProgress,
  DiagnosticProgressError,
  type DiagnosticScenario,
} from "@/src/modules/diagnostic";

const scenario: DiagnosticScenario = {
  stableKey: "diagnostic.progress",
  version: 1,
  status: "published",
  tasks: [0, 1, 2].map((position) => ({
    goalKey: `goal-${position}`,
    position,
    prompt: `Prompt ${position}`,
    targetExpressionKeys: [`expression-${position}`],
  })),
};

describe("diagnostic progress", () => {
  it("defaults to speech and exposes data insufficiency explicitly", () => {
    const plan = createDiagnosticPlan(scenario);
    expect(createDiagnosticProgress(plan)).toMatchObject({
      currentTaskIndex: 0,
      defaultInputMode: "speech",
      profileStatus: "data-insufficient",
      status: "in-progress",
    });
  });

  it("advances in order and completes after the final task", () => {
    const plan = createDiagnosticPlan(scenario);
    let progress = createDiagnosticProgress(plan);

    progress = advanceDiagnosticProgress(progress, plan, plan.tasks[0]!.id, "speech");
    expect(progress).toMatchObject({ currentTaskIndex: 1, completedTaskCount: 1 });

    progress = advanceDiagnosticProgress(progress, plan, plan.tasks[1]!.id, "typing");
    progress = advanceDiagnosticProgress(progress, plan, plan.tasks[2]!.id, "speech", "available");

    expect(progress).toMatchObject({
      completedTaskCount: 3,
      currentTaskIndex: 3,
      lastInputMode: "speech",
      profileStatus: "available",
      status: "completed",
    });
  });

  it("rejects a task completed out of order without changing progress", () => {
    const plan = createDiagnosticPlan(scenario);
    const progress = createDiagnosticProgress(plan);

    expect(() =>
      advanceDiagnosticProgress(progress, plan, plan.tasks[1]!.id, "speech"),
    ).toThrowError(
      expect.objectContaining<Partial<DiagnosticProgressError>>({
        code: "task-out-of-order",
      }),
    );
    expect(progress.currentTaskIndex).toBe(0);
  });
});
