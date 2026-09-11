import { notFound, redirect } from "next/navigation";

import { createDrizzleScenarioLibraryRepository, createDrizzleScenarioPracticeRepository, getScenarioPracticeDetailForUser, prepareReviewedTurnRetry, ScenarioPracticeWorkbench } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export default async function ScenarioPracticePage({ params, searchParams }: Readonly<{ params: Promise<{ scenarioId: string }>; searchParams: Promise<{ sourceSessionId?: string | string[]; retryTurnId?: string | string[]; repetitionId?: string | string[] }> }>) {
  const { scenarioId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/explore/scenarios/${scenarioId}/practice`)}`);
  const key = decodeURIComponent(scenarioId);
  const database = process.env.DATABASE_URL ? getDatabase() : null;
  const scenario = await getScenarioPracticeDetailForUser(database ? createDrizzleScenarioLibraryRepository(database) : null, key, user.id);
  if (!scenario || (!key.startsWith("personal.") && process.env.NODE_ENV === "production" && scenario.status !== "published")) notFound();
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  let retryText: string | null = null;
  let repetitionGoal: string | null = null;
  if (database && first(query.sourceSessionId) && first(query.retryTurnId)) {
    const retry = await prepareReviewedTurnRetry(createDrizzleScenarioPracticeRepository(database), { userId: user.id, sourceSessionId: first(query.sourceSessionId)!, turnId: first(query.retryTurnId)!, scenarioKey: key }).catch(() => null);
    if (!retry) notFound();
    retryText = retry.originalText;
  }
  if (database && first(query.repetitionId)) {
    const repository = createDrizzleScenarioPracticeRepository(database);
    const item = await repository.getRepetitionItem(user.id, first(query.repetitionId)!).catch(() => null);
    const source = item ? await repository.getSession(user.id, item.sourceSessionId).catch(() => null) : null;
    if (!item || item.status !== "pending" || source?.scenarioKey !== key) notFound();
    repetitionGoal = item.goalSnapshot;
  }
  return <ScenarioPracticeWorkbench scenario={scenario} retryText={retryText} repetitionGoal={repetitionGoal} />;
}
