import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getExploreDashboardForUser } from "@/src/modules/explore";
import { BundleExploreRepository, CatalogExploreLibraryRepository, emptyExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";

import { ExplorePageContent, type ExploreView } from "./explore-page-content";

export const metadata: Metadata = { title: "探索" };

type ExplorePageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The public catalogue is the page.
 *
 * Scenarios, expressions and content packs all come from the validated content
 * bundles, so this component reads no database row and awaits no per-user
 * read: the tree below is returned synchronously and the owned part of the
 * library (personal scenarios, saved expressions, reading highlights, recent
 * errors) is fetched by `ExplorePageContent` after paint, exactly like
 * `/read` fetches reading progress after paint.
 *
 * The previous shape awaited `getExploreDashboardForUser` (which reads
 * `user_content_pack_states`) and `getExploreLibraryForUser` (which reads
 * `personal_scenarios`, `user_saved_expressions`, `user_article_highlights` and
 * `scenario_turn_reviews`) in one `Promise.all` before it could return
 * anything, so a private round trip held the public page open on every visit.
 */
export default async function ExplorePage({ searchParams }: ExplorePageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fexplore");
  const dashboardOptions = {
    // Draft content remains blocked in production; local development can inspect
    // the complete interaction flow without publishing unreviewed material.
    allowDraft: process.env.NODE_ENV !== "production",
  } as const;
  // Public shell: the same bundle repositories the dashboard route uses, with
  // the empty user-state repository, so this await touches no database. The
  // per-user state (pack progress and saved packs) arrives with the client
  // fetch below.
  const dashboard = await getExploreDashboardForUser(
    new BundleExploreRepository(),
    emptyExploreUserStateRepository,
    user.id,
    dashboardOptions,
  );
  // `privateState: "loading"` is the honest value here: the public scenarios
  // and expressions are real and complete, and the owned part has not been read
  // yet. It is deliberately not "unavailable" (see explore-library.ts).
  const library = new CatalogExploreLibraryRepository().publicLibrary(dashboardOptions);
  const params = await searchParams;
  const filter = first(params.filter);
  const view = first(params.view);
  const initialView: ExploreView | undefined = view === "scenarios" || view === "expressions" || view === "packs" ? view : undefined;
  return <ExplorePageContent allowDraftPreview={process.env.NODE_ENV !== "production"} dashboard={dashboard} library={library} userId={user.id} initialView={initialView} initialQuery={first(params.q) ?? ""} initialPack={first(params.pack) ?? null} initialSaved={first(params.saved) === "1"} initialFilter={filter === "formal" || filter === "saved" || filter === "recent-error" || filter === "reading" || filter === "available" ? filter : "all"} />;
}
