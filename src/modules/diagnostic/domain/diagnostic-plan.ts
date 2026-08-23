export const diagnosticPlanErrorCodes = [
  "scenario-not-published",
  "task-count-invalid",
  "task-position-invalid",
  "task-key-invalid",
] as const;

export type DiagnosticPlanErrorCode = (typeof diagnosticPlanErrorCodes)[number];

export class DiagnosticPlanError extends Error {
  readonly code: DiagnosticPlanErrorCode;

  constructor(code: DiagnosticPlanErrorCode, message: string) {
    super(message);
    this.name = "DiagnosticPlanError";
    this.code = code;
  }
}

export type DiagnosticScenarioTask = Readonly<{
  goalKey: string;
  position: number;
  prompt: string;
  targetExpressionKeys: readonly string[];
}>;

export type DiagnosticScenario = Readonly<{
  stableKey: string;
  version: number;
  status: "draft" | "language-reviewed" | "pedagogy-reviewed" | "published";
  tasks: readonly DiagnosticScenarioTask[];
}>;

export type DiagnosticTask = Readonly<
  DiagnosticScenarioTask & {
    id: string;
  }
>;

export type DiagnosticPlan = Readonly<{
  id: string;
  scenarioKey: string;
  contentVersion: number;
  tasks: readonly DiagnosticTask[];
}>;

function fail(code: DiagnosticPlanErrorCode, message: string): never {
  throw new DiagnosticPlanError(code, message);
}

export function createDiagnosticPlan(
  scenario: DiagnosticScenario,
): DiagnosticPlan {
  if (scenario.status !== "published") {
    return fail(
      "scenario-not-published",
      "Initial diagnostics require a published scenario.",
    );
  }

  if (scenario.tasks.length < 3 || scenario.tasks.length > 5) {
    return fail(
      "task-count-invalid",
      "Initial diagnostics require between three and five tasks.",
    );
  }

  const tasks = [...scenario.tasks].sort((left, right) => left.position - right.position);
  const diagnosticTasks = tasks.map((task, index) => {
    if (
      !Number.isInteger(task.position) ||
      task.position !== index ||
      !task.goalKey.trim() ||
      !task.prompt.trim() ||
      task.targetExpressionKeys.length === 0
    ) {
      return fail(
        task.goalKey.trim() && task.prompt.trim() && task.targetExpressionKeys.length > 0
          ? "task-position-invalid"
          : "task-key-invalid",
        "Initial diagnostic tasks must have contiguous positions and usable keys.",
      );
    }

    return {
      ...task,
      id: `${scenario.stableKey}@${scenario.version}:${task.position}`,
    } satisfies DiagnosticTask;
  });

  return {
    id: `${scenario.stableKey}@${scenario.version}`,
    scenarioKey: scenario.stableKey,
    contentVersion: scenario.version,
    tasks: diagnosticTasks,
  };
}
