import { getPublicScenarioDetail } from "@/src/modules/scenario-practice";
import { scenarioData, scenarioError } from "@/app/api/v1/scenario-practice/http";

export async function GET(_request: Request, { params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const scenario = getPublicScenarioDetail(decodeURIComponent(scenarioId));
  if (!scenario || (process.env.NODE_ENV === "production" && scenario.status !== "published")) return scenarioError(_request, "SCENARIO_NOT_FOUND", "The scenario was not found.", 404);
  return scenarioData(scenario, { headers: { "cache-control": "private, max-age=60" } });
}
