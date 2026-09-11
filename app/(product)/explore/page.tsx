import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getExploreDashboardForUser } from "@/src/modules/explore";
import { BundleExploreRepository, createDrizzleExploreUserStateRepository, emptyExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { getDatabase } from "@/src/shared/db/client";
import { getCurrentUser } from "@/src/shared/auth/server";
import { listScenarioPracticeDetails } from "@/src/modules/scenario-practice";
import { createDrizzleScenarioLibraryRepository } from "@/src/modules/scenario-practice";

import { ExplorePageContent } from "./explore-page-content";

export const metadata: Metadata = { title: "探索" };

type ExplorePageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fexplore");
  const userStateRepository = process.env.DATABASE_URL
    ? createDrizzleExploreUserStateRepository(getDatabase())
    : emptyExploreUserStateRepository;
  const dashboardOptions = {
    // Draft content remains blocked in production; local development can inspect
    // the complete interaction flow without publishing unreviewed material.
    allowDraft: process.env.NODE_ENV !== "production",
  } as const;
  let dashboard;
  try {
    dashboard = await getExploreDashboardForUser(
      new BundleExploreRepository(),
      userStateRepository,
      user.id,
      dashboardOptions,
    );
  } catch {
    // User state is auxiliary to the content index. If the database is
    // temporarily unreachable, keep the explore goals and packs usable while
    // clearly marking persistence as unavailable in the DTO.
    dashboard = await getExploreDashboardForUser(
      new BundleExploreRepository(),
      emptyExploreUserStateRepository,
      user.id,
      dashboardOptions,
    );
  }
  const params = await searchParams;
  type ScenarioEntry = { stableKey: string; title: string; description: string; cefr: string; role: string; sourceKind: "public" | "personal" };
  const publicScenarios: ScenarioEntry[] = listScenarioPracticeDetails().filter((scenario) => process.env.NODE_ENV !== "production" || scenario.status === "published").map((scenario) => ({
    stableKey: scenario.stableKey,
    title: scenario.title,
    description: scenario.description,
    cefr: scenario.cefr,
    role: scenario.temporaryCharacter.role,
    sourceKind: "public" as const,
  }));
  let personalScenarios: ScenarioEntry[] = [];
  if (process.env.DATABASE_URL) {
    try {
      personalScenarios = (await createDrizzleScenarioLibraryRepository(getDatabase()).listPersonalSuggestionCandidates(user.id)).map((scenario) => ({ stableKey: `personal.${scenario.id}`, title: scenario.title, description: scenario.description, cefr: scenario.cefr, role: scenario.role, sourceKind: "personal" as const }));
    } catch { /* Public Explore content remains usable while private data is unavailable. */ }
  }
  const scenarios = [...personalScenarios, ...publicScenarios];
  return <ExplorePageContent allowDraftPreview={process.env.NODE_ENV !== "production"} dashboard={dashboard} scenarios={scenarios} initialQuery={first(params.q) ?? ""} initialPack={first(params.pack) ?? null} initialSaved={first(params.saved) === "1"} />;
}
