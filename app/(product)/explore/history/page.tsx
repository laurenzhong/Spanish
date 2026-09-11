import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { createDrizzleScenarioPracticeRepository, listScenarioHistory, ScenarioHistory } from "@/src/modules/scenario-practice";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "场景练习历史" };

export default async function ScenarioHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fexplore%2Fhistory");
  const items = process.env.DATABASE_URL
    ? await listScenarioHistory(createDrizzleScenarioPracticeRepository(getDatabase()), user.id).catch(() => [])
    : [];
  return <ScenarioHistory items={items} />;
}
