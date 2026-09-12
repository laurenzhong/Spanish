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
  initialQuery?: string;
  initialPack?: string | null;
  initialSaved?: boolean;
  initialFilter?: ExploreLibraryFilter;
  allowDraftPreview?: boolean;
}>;

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

export function ExplorePageContent({ library = emptyLibrary, initialQuery = "", initialFilter = "all" }: ExplorePageContentProps) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ExploreLibraryFilter>(initialFilter === "available" ? "available" : "all");

  function updateUrl(nextQuery: string, nextFilter = filter) {
    const params = new URLSearchParams(window.location.search);
    if (nextQuery) params.set("q", nextQuery); else params.delete("q");
    if (nextFilter === "available") params.set("filter", nextFilter); else params.delete("filter");
    params.delete("pack");
    params.delete("saved");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  useEffect(() => {
    updateUrl(query, filter);
    // updateUrl is an intentionally local URL adapter; state values trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, query]);

  function clearSearchAndFilters() {
    setQuery("");
    setFilter("all");
    updateUrl("", "all");
  }

  return (
    <div className="page-stack explore-page">
      <h1 className="sr-only">探索场景</h1>
      <div className="explore-discovery-controls">
        <section className="explore-intent" aria-label="按意图查找">
          <label className="explore-intent__field">
            <span className="sr-only">搜索场景</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                updateUrl(event.target.value);
              }}
              placeholder="搜索场景"
            />
            {query
              ? <button type="button" aria-label="清除搜索" onClick={() => { setQuery(""); updateUrl(""); }}><CloseIcon /></button>
              : <span aria-hidden="true"><SearchIcon /></span>}
          </label>
        </section>
        <ScenarioSuggestionPanel onTopicSelected={(topic) => { setQuery(topic); updateUrl(topic); }} />
      </div>

      <ExploreLibraryPanel
        library={library}
        query={query}
        filter={filter}
        onFilterChange={(nextFilter) => {
          const scenarioFilter = nextFilter === "available" ? "available" : "all";
          setFilter(scenarioFilter);
          updateUrl(query, scenarioFilter);
        }}
        onClear={clearSearchAndFilters}
      />
    </div>
  );
}
