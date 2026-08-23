import {
  recordEvidence,
  type EvidenceRepository,
  type RecordEvidenceResult,
} from "@/src/modules/evidence";
import {
  advanceDiagnosticProgress,
  type DiagnosticInputMode,
  type DiagnosticProgress,
} from "../domain/diagnostic-progress";
import type { DiagnosticPlan } from "../domain/diagnostic-plan";

export type CompleteDiagnosticTaskInput = Readonly<{
  plan: DiagnosticPlan;
  progress: DiagnosticProgress;
  taskId: string;
  inputMode: DiagnosticInputMode;
  evaluation: unknown;
}>;

export type CompleteDiagnosticTaskResult = Readonly<{
  progress: DiagnosticProgress;
  evidence: RecordEvidenceResult;
  advanced: boolean;
}>;

export async function completeDiagnosticTask(
  repository: EvidenceRepository,
  input: CompleteDiagnosticTaskInput,
): Promise<CompleteDiagnosticTaskResult> {
  const expectedTask = input.plan.tasks[input.progress.currentTaskIndex];
  if (!expectedTask || expectedTask.id !== input.taskId) {
    return {
      advanced: false,
      evidence: {
        events: [],
        skillStates: [],
        status: "ignored",
        reason: "task-out-of-order",
      },
      progress: input.progress,
    };
  }

  const evidence = await recordEvidence(repository, input.evaluation);
  if (evidence.status === "ignored") {
    return {
      advanced: false,
      evidence,
      progress: input.progress,
    };
  }

  return {
    advanced: true,
    evidence,
    progress: advanceDiagnosticProgress(
      input.progress,
      input.plan,
      input.taskId,
      input.inputMode,
    ),
  };
}
