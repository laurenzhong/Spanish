"use client";

import Link from "next/link";

import type { VocabularyQuery } from "../schemas";

export const vocabularyViewHrefBasePath = "/read/vocabulary";
export const vocabularyViews = ["study", "frequency", "lexicon"] as const;

export type VocabularyView = (typeof vocabularyViews)[number];

/**
 * The reader's reading preferences, not the current view's position: these are
 * the query values a view switch carries over. Every field is optional because
 * the page fills them with schema defaults and a switch must not invent a value
 * the reader never chose.
 */
export type VocabularyViewQuery = Readonly<{
  search?: string;
  intent?: VocabularyQuery["intent"];
  lemmaStatus?: VocabularyQuery["lemmaStatus"];
  pageSize?: number;
}>;

/**
 * The three shelves the vocabulary page can show. They are three readings of
 * the same URL, so the label is the only thing pinned here; the destination is
 * always `/read/vocabulary?view=...`.
 */
const viewLabels: Record<VocabularyView, string> = {
  study: "学习词表",
  frequency: "语料高频词",
  lexicon: "正式词元",
};

/**
 * The link a view tab points at. The URL stays the source of truth, so the tab
 * is expressed as a real destination instead of local tab state.
 *
 * `search` and `pageSize` describe how the reader wants to read the shelf and
 * survive every switch. `page` is dropped because each view paginates its own
 * list, and `intent`/`lemmaStatus` are lexicon-only filters that would silently
 * narrow another view or produce an unreadable URL.
 */
export function vocabularyViewHref(view: VocabularyView, query: VocabularyViewQuery): string {
  const parameters = new URLSearchParams({ view });
  if (query.search) parameters.set("search", query.search);
  if (query.pageSize) parameters.set("pageSize", String(query.pageSize));
  if (view === "lexicon") {
    if (query.intent) parameters.set("intent", query.intent);
    if (query.lemmaStatus) parameters.set("lemmaStatus", query.lemmaStatus);
  }
  return `${vocabularyViewHrefBasePath}?${parameters.toString()}`;
}

/**
 * The second-level control under the page heading: which shelf of the
 * vocabulary page is open.
 *
 * It is a navigation, not an ARIA tab set. Every view is a different URL with
 * its own server-rendered content, so the destinations are real links marked
 * with `aria-current="page"` — the same contract the read section navigation
 * uses. `role="tab"` would promise panel switching that never happens. The
 * `sueno-tabs*` classes only provide the shared segmented-control look.
 */
export function VocabularyViewSwitcher({ view, query }: Readonly<{ view: VocabularyView; query: VocabularyViewQuery }>) {
  return (
    <nav aria-label="词汇视图" className="sueno-tabs lexicon-view-switcher">
      <div className="sueno-tabs-list">
        {vocabularyViews.map((candidate) => (
          <Link
            aria-current={candidate === view ? "page" : undefined}
            className={candidate === view ? "sueno-tabs-trigger is-active" : "sueno-tabs-trigger"}
            href={vocabularyViewHref(candidate, query)}
            key={candidate}
          >
            {viewLabels[candidate]}
          </Link>
        ))}
      </div>
    </nav>
  );
}
