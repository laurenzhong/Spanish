import { notFound } from "next/navigation";

import { getScenarioPracticeDetail, ScenarioBasicReview } from "@/src/modules/scenario-practice";

export default async function ScenarioReviewPage({ params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const scenario = getScenarioPracticeDetail(decodeURIComponent(scenarioId));
  if (!scenario || (process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  return <ScenarioBasicReview scenario={scenario} />;
}
