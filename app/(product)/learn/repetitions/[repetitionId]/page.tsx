import { notFound, redirect } from "next/navigation";

import { createDrizzleScenarioPracticeRepository, DueRepetition } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export default async function DueRepetitionPage({ params }: Readonly<{ params: Promise<{ repetitionId: string }> }>) {
  const user = await getCurrentUser();
  const { repetitionId } = await params;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/learn/repetitions/${repetitionId}`)}`);
  if (!process.env.DATABASE_URL) notFound();
  const repository = createDrizzleScenarioPracticeRepository(getDatabase());
  const item = await repository.getRepetitionItem(user.id, repetitionId).catch(() => null);
  if (!item || item.status !== "pending") notFound();
  const session = await repository.getSession(user.id, item.sourceSessionId).catch(() => null);
  return <DueRepetition item={item} scenarioKey={session?.scenarioKey ?? null} />;
}
