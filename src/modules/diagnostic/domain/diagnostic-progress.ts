import type { DiagnosticPlan } from "./diagnostic-plan";

export const diagnosticInputModes = ["speech", "typing"] as const;
export type DiagnosticInputMode = (typeof diagnosticInputModes)[number];

export const diagnosticProgressStatuses = ["in-progress", "completed"] as const;
export type DiagnosticProgressStatus = (typeof diagnosticProgressStatuses)[number];

export const diagnosticProfileStatuses = ["data-insufficient", "available"] as const;
export type DiagnosticProfileStatus = (typeof diagnosticProfileStatuses)[number];

export const diagnosticProgressErrorCodes = [
  "task-out-of-order",
  "diagnostic-already-completed",
] as const;
export type DiagnosticProgressErrorCode =
  (typeof diagnosticProgressErrorCodes)[number];

export class DiagnosticProgressError extends Error {
  readonly code: DiagnosticProgressErrorCode;

  constructor(code: DiagnosticProgressErrorCode, message: string) {
    super(message);
    this.name = "DiagnosticProgressError";
    this.code = code;
  }
}

export type DiagnosticProgress = Readonly<{
  planId: string;
  currentTaskIndex: number;
  completedTaskCount: number;
  defaultInputMode: "speech";
  lastInputMode: DiagnosticInputMode | null;
  profileStatus: DiagnosticProfileStatus;
  status: DiagnosticProgressStatus;
}>;

export function createDiagnosticProgress(
  plan: DiagnosticPlan,
  profileStatus: DiagnosticProfileStatus = "data-insufficient",
): DiagnosticProgress {
  return {
    planId: plan.id,
    currentTaskIndex: 0,
    completedTaskCount: 0,
    defaultInputMode: "speech",
    lastInputMode: null,
    profileStatus,
    status: "in-progress",
  };
}

export function advanceDiagnosticProgress(
  progress: DiagnosticProgress,
  plan: DiagnosticPlan,
  taskId: string,
  inputMode: DiagnosticInputMode,
  profileStatus = progress.profileStatus,
): DiagnosticProgress {
  if (progress.status === "completed") {
    throw new DiagnosticProgressError(
      "diagnostic-already-completed",
      "A completed diagnostic cannot accept another task.",
    );
  }

  const expectedTask = plan.tasks[progress.currentTaskIndex];
  if (!expectedTask || expectedTask.id !== taskId) {
    throw new DiagnosticProgressError(
      "task-out-of-order",
      "Diagnostic tasks must be completed in order.",
    );
  }

  const completedTaskCount = progress.completedTaskCount + 1;
  const completed = completedTaskCount === plan.tasks.length;

  return {
    ...progress,
    currentTaskIndex: completed ? plan.tasks.length : progress.currentTaskIndex + 1,
    completedTaskCount,
    lastInputMode: inputMode,
    profileStatus,
    status: completed ? "completed" : "in-progress",
  };
}
