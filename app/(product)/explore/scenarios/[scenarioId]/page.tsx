import { notFound } from "next/navigation";

import { getScenarioPracticeDetail, ScenarioDetail } from "@/src/modules/scenario-practice";

export default async function ScenarioDetailPage({ params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const scenario = getScenarioPracticeDetail(decodeURIComponent(scenarioId));
  if (!scenario || (process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  return <ScenarioDetail scenario={scenario} />;
}
