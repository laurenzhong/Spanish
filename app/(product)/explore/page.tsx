import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getExploreDashboardForUser, getExploreLibraryForUser } from "@/src/modules/explore";
import { BundleExploreRepository, CatalogExploreLibraryRepository, createDrizzleExploreUserStateRepository, emptyExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { getDatabase } from "@/src/shared/db/client";
import { getCurrentUser } from "@/src/shared/auth/server";
import { createDrizzleScenarioLibraryRepository } from "@/src/modules/scenario-practice";

import { ExplorePageContent, type ExploreView } from "./explore-page-content";

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
  const database = process.env.DATABASE_URL ? getDatabase() : null;
  const userStateRepository = database ? createDrizzleExploreUserStateRepository(database) : emptyExploreUserStateRepository;
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
  const library = await getExploreLibraryForUser(
    new CatalogExploreLibraryRepository(database ? createDrizzleScenarioLibraryRepository(database) : undefined),
    user.id,
    dashboardOptions,
  );
  const filter = first(params.filter);
  const view = first(params.view);
  const initialView: ExploreView | undefined = view === "scenarios" || view === "expressions" || view === "packs" ? view : undefined;
  return <ExplorePageContent allowDraftPreview={process.env.NODE_ENV !== "production"} dashboard={dashboard} library={library} initialView={initialView} initialQuery={first(params.q) ?? ""} initialPack={first(params.pack) ?? null} initialSaved={first(params.saved) === "1"} initialFilter={filter === "formal" || filter === "saved" || filter === "recent-error" || filter === "reading" || filter === "available" ? filter : "all"} />;
}
