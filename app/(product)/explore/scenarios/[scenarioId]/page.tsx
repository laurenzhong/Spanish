import { notFound, redirect } from "next/navigation";

import { createDrizzleScenarioLibraryRepository, getScenarioPracticeDetailForUser, ScenarioDetail } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export default async function ScenarioDetailPage({ params }: Readonly<{ params: Promise<{ scenarioId: string }> }>) {
  const { scenarioId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/explore/scenarios/${scenarioId}`)}`);
  const key = decodeURIComponent(scenarioId);
  const scenario = await getScenarioPracticeDetailForUser(process.env.DATABASE_URL ? createDrizzleScenarioLibraryRepository(getDatabase()) : null, key, user.id);
  if (!scenario || (!key.startsWith("personal.") && process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  return <ScenarioDetail scenario={scenario} />;
}
