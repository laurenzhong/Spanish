import type { Metadata } from "next";

import { getCurrentUser } from "@/src/shared/auth/server";
import { createDrizzleScenarioPracticeRepository, listDueScenarioRepetitions } from "@/src/modules/scenario-practice";
import { getDatabase } from "@/src/shared/db/client";

import { LearnPageContent } from "./learn-page-content";

export const metadata: Metadata = {
  title: "学习",
};

export default async function LearnPage() {
  const user = await getCurrentUser();
  const due = user && process.env.DATABASE_URL
    ? (await listDueScenarioRepetitions(createDrizzleScenarioPracticeRepository(getDatabase()), user.id, () => new Date(), 1).catch(() => []))[0]
    : null;
  return <LearnPageContent userId={user?.id ?? "local-user"} dueRepetition={due ? { id: due.id, goalSnapshot: due.goalSnapshot, dueAt: due.dueAt.toISOString() } : null} />;
}
