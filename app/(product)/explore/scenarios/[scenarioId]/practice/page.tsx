import { notFound } from "next/navigation";

import { getScenarioPracticeDetail, ScenarioPracticeWorkbench } from "@/src/modules/scenario-practice";

export default async function ScenarioPracticePage({ params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const scenario = getScenarioPracticeDetail(decodeURIComponent(scenarioId));
  if (!scenario || (process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  return <ScenarioPracticeWorkbench scenario={scenario} />;
}
