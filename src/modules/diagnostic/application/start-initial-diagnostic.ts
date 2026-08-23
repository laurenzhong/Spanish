import {
  createDiagnosticPlan,
  type DiagnosticPlan,
  type DiagnosticScenario,
} from "../domain/diagnostic-plan";
import {
  createDiagnosticProgress,
  type DiagnosticProfileStatus,
  type DiagnosticProgress,
} from "../domain/diagnostic-progress";

export type InitialDiagnosticSession = Readonly<{
  plan: DiagnosticPlan;
  progress: DiagnosticProgress;
}>;

export function startInitialDiagnostic(
  scenario: DiagnosticScenario,
  profileStatus: DiagnosticProfileStatus = "data-insufficient",
): InitialDiagnosticSession {
  const plan = createDiagnosticPlan(scenario);

  return {
    plan,
    progress: createDiagnosticProgress(plan, profileStatus),
  };
}
