"use client";

import { useEffect, useState } from "react";

import type { ExploreDashboardDto } from "@/src/modules/explore/domain";
import type { ExploreLibraryDto, ExploreLibraryFilter } from "@/src/modules/explore/domain/explore-library";

import { ExploreLibraryPanel } from "./explore-library-panel";
import { ScenarioSuggestionPanel } from "./scenario-suggestion-panel";

const emptyLibrary: ExploreLibraryDto = { scenarios: [], expressions: [], privateState: "unavailable" };

type ExplorePageContentProps = Readonly<{
  dashboard: ExploreDashboardDto;
  library?: ExploreLibraryDto;
  initialView?: ExploreView;
  initialQuery?: string;
  initialPack?: string | null;
  initialSaved?: boolean;
  initialFilter?: ExploreLibraryFilter;
  allowDraftPreview?: boolean;
}>;

export type ExploreView = "scenarios" | "expressions" | "packs";

const views: readonly Readonly<{ value: ExploreView; label: string }>[] = [
  { value: "scenarios", label: "场景" },
  { value: "expressions", label: "表达" },
  { value: "packs", label: "内容包" },
];

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

function viewForLegacyState(initialView: ExploreView | undefined, initialPack: string | null, initialSaved: boolean, initialFilter: ExploreLibraryFilter): ExploreView {
  if (initialView) return initialView;
  if (initialPack) return "packs";
  if (initialSaved || initialFilter === "formal" || initialFilter === "saved" || initialFilter === "reading" || initialFilter === "recent-error") return "expressions";
  return "scenarios";
}

function filterForView(view: ExploreView, filter: ExploreLibraryFilter): ExploreLibraryFilter {
  if (view === "scenarios") return filter === "available" ? filter : "all";
  if (view === "expressions") return filter === "formal" || filter === "saved" || filter === "reading" || filter === "recent-error" ? filter : "all";
  return filter === "saved" || filter === "available" ? filter : "all";
}

export function ExplorePageContent({ dashboard, library = emptyLibrary, initialView, initialQuery = "", initialPack = null, initialSaved = false, initialFilter = "all" }: ExplorePageContentProps) {
  const resolvedInitialView = viewForLegacyState(initialView, initialPack, initialSaved, initialFilter);
  const resolvedInitialFilter = filterForView(resolvedInitialView, resolvedInitialView === "expressions" && initialSaved ? "saved" : initialFilter);
  const [view, setView] = useState<ExploreView>(resolvedInitialView);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ExploreLibraryFilter>(resolvedInitialFilter);
  const [selectedPack, setSelectedPack] = useState<string | null>(resolvedInitialView === "packs" ? initialPack : null);

  function updateUrl(next: Readonly<{ query?: string; view?: ExploreView; filter?: ExploreLibraryFilter; pack?: string | null }> = {}) {
    const nextQuery = next.query ?? query;
    const nextView = next.view ?? view;
    const nextFilter = next.filter ?? filter;
    const nextPack = next.pack === undefined ? selectedPack : next.pack;
    const params = new URLSearchParams(window.location.search);
    if (nextQuery) params.set("q", nextQuery); else params.delete("q");
    if (nextView === "scenarios") params.delete("view"); else params.set("view", nextView);
    if (nextFilter === "all") params.delete("filter"); else params.set("filter", nextFilter);
    if (nextView === "packs" && nextPack) params.set("pack", nextPack); else params.delete("pack");
    params.delete("saved");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  useEffect(() => {
    updateUrl({ query: initialQuery, view: resolvedInitialView, filter: resolvedInitialFilter, pack: resolvedInitialView === "packs" ? initialPack : null });
    // Normalize legacy pack/saved links once; later state changes update the URL at their action boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearSearchAndFilters() {
    setQuery("");
    setFilter("all");
    setSelectedPack(null);
    updateUrl({ query: "", filter: "all", pack: null });
  }

  function selectView(nextView: ExploreView) {
    const nextFilter = filterForView(nextView, filter);
    setView(nextView);
    setFilter(nextFilter);
    if (nextView !== "packs") setSelectedPack(null);
    updateUrl({ view: nextView, filter: nextFilter, pack: nextView === "packs" ? selectedPack : null });
  }

  return (
    <div className="page-stack explore-page">
      <h1 className="sr-only">探索场景</h1>
      <div className="explore-discovery-controls">
        <section className="explore-intent" aria-label="按意图查找">
          <label className="explore-intent__field">
            <span className="sr-only">{view === "scenarios" ? "搜索场景" : view === "expressions" ? "搜索表达" : "搜索内容包"}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                updateUrl({ query: event.target.value });
              }}
              placeholder={view === "scenarios" ? "搜索场景" : view === "expressions" ? "搜索表达" : "搜索内容包"}
            />
            {query
              ? <button type="button" aria-label="清除搜索" onClick={() => { setQuery(""); updateUrl({ query: "" }); }}><CloseIcon /></button>
              : <span aria-hidden="true"><SearchIcon /></span>}
          </label>
        </section>
        <ScenarioSuggestionPanel onTopicSelected={(topic) => { setQuery(topic); updateUrl({ query: topic }); }} />
      </div>

      <div className="explore-view-tabs" role="tablist" aria-label="探索内容">
        {views.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`explore-tab-${item.value}`}
            aria-selected={view === item.value}
            aria-controls={`explore-panel-${item.value}`}
            tabIndex={view === item.value ? 0 : -1}
            onClick={() => selectView(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ExploreLibraryPanel
        dashboard={dashboard}
        library={library}
        view={view}
        query={query}
        filter={filter}
        selectedPack={selectedPack}
        onFilterChange={(nextFilter) => {
          const validFilter = filterForView(view, nextFilter);
          setFilter(validFilter);
          updateUrl({ filter: validFilter });
        }}
        onPackSelected={(pack) => {
          setSelectedPack(pack);
          updateUrl({ pack });
        }}
        onClear={clearSearchAndFilters}
      />
    </div>
  );
}
