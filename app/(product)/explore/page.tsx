import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getExploreDashboardForUser } from "@/src/modules/explore";
import { BundleExploreRepository, emptyExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";

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
  const dashboard = await getExploreDashboardForUser(new BundleExploreRepository(), emptyExploreUserStateRepository, user.id);
  const params = await searchParams;
  return <ExplorePageContent dashboard={dashboard} initialQuery={first(params.q) ?? ""} initialPack={first(params.pack) ?? null} />;
}
