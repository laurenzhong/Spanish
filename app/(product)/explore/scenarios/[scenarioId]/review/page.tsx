import { notFound, redirect } from "next/navigation";

import { createDrizzleScenarioLibraryRepository, createDrizzleScenarioPracticeRepository, getScenarioPracticeDetailForUser, getScenarioSessionReview, ScenarioBasicReview, ScenarioReview } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export default async function ScenarioReviewPage({ params, searchParams }: Readonly<{ params: Promise<{ scenarioId: string }>; searchParams: Promise<{ sessionId?: string | string[] }> }>) {
  const { scenarioId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/explore/scenarios/${scenarioId}/review`)}`);
  const key = decodeURIComponent(scenarioId);
  const sessionParam = (await searchParams).sessionId;
  const sessionId = Array.isArray(sessionParam) ? sessionParam[0] : sessionParam;
  const scenario = await getScenarioPracticeDetailForUser(process.env.DATABASE_URL ? createDrizzleScenarioLibraryRepository(getDatabase()) : null, key, user.id);
  if (!scenario || (!key.startsWith("personal.") && process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  if (sessionId && process.env.DATABASE_URL) {
    const review = await getScenarioSessionReview(createDrizzleScenarioPracticeRepository(getDatabase()), user.id, sessionId).catch(() => null);
    if (!review || (review.scenarioKey && review.scenarioKey !== key)) notFound();
    return <ScenarioReview review={review} />;
  }
  return <ScenarioBasicReview scenario={scenario} />;
}
