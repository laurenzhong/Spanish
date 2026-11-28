"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { ExploreDashboardDto } from "@/src/modules/explore/domain";
import type { ExploreExpressionGenerationSource, ExploreLibraryDto, ExploreLibraryFilter, ExplorePrivateState } from "@/src/modules/explore/domain/explore-library";
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@/src/shared/ui/primitives";

import { ExploreLibraryPanel } from "./explore-library-panel";
import { PersonalScenarioGenerator } from "./personal-scenario-generator";
import { ScenarioSuggestionPanel } from "./scenario-suggestion-panel";
import "./explore.css";

const emptyLibrary: ExploreLibraryDto = { scenarios: [], expressions: [], privateState: "unavailable" };

type ExplorePageContentProps = Readonly<{
  dashboard: ExploreDashboardDto;
  library?: ExploreLibraryDto;
  /**
   * The signed-in user, used only to fetch the owned part of the library after
   * paint. Without it (unit tests, or a caller that already owns the merge) this
   * component makes no request.
   */
  userId?: string;
  initialView?: ExploreView;
  initialQuery?: string;
  initialPack?: string | null;
  initialSaved?: boolean;
  initialFilter?: ExploreLibraryFilter;
  allowDraftPreview?: boolean;
}>;

export type ExploreView = "scenarios" | "expressions" | "packs";

type ExplorePrivatePayload = Readonly<{ dashboard: ExploreDashboardDto; library: ExploreLibraryDto }>;
type GeneratorSource = Readonly<{ source: ExploreExpressionGenerationSource; label: string }>;

/** The route spreads the dashboard fields beside `library`, so both live at `data`. */
type ExplorePrivateResponse = Readonly<{
  library?: ExploreLibraryDto;
  goals?: ExploreDashboardDto["goals"];
  packs?: ExploreDashboardDto["packs"];
  resume?: ExploreDashboardDto["resume"];
  userState?: ExploreDashboardDto["userState"];
}>;

/**
 * The owned part of the explore page, read by the browser after paint.
 *
 * This is the payload `/api/v1/explore/dashboard` already served (the route
 * spreads the dashboard fields beside `library`), so the DTO shape is
 * unchanged; what changed is that the public tree no longer waits for it. The
 * server sends the bundle-backed catalogue (`privateState: "loading"`), and
 * this request supplies the personal scenarios, saved expressions, highlights
 * and recent errors when they are ready. Against the remote pooler, the
 * per-user reads it defers are the 250-600 ms round trip that used to sit in
 * front of the first paint.
 */
async function fetchPrivateExploreData(signal: AbortSignal): Promise<ExplorePrivatePayload> {
  const response = await fetch("/api/v1/explore/dashboard", { credentials: "same-origin", signal });
  if (!response.ok) throw new Error("explore-private-unavailable");
  const payload = (await response.json()) as { data?: ExplorePrivateResponse };
  const { library, goals, packs, resume, userState } = payload.data ?? {};
  if (
    !library
    || !Array.isArray(library.scenarios)
    || !Array.isArray(library.expressions)
    || !Array.isArray(goals)
    || !Array.isArray(packs)
    || !Array.isArray(resume)
  ) {
    throw new Error("explore-private-invalid");
  }
  return {
    dashboard: { goals, packs, resume, userState: userState === "available" ? "available" : "unavailable" },
    library,
  };
}

/**
 * A failed owned-read is a different fact from a read that has not finished:
 * the saved and available filters ("我的收藏", "可打开") and the notice copy are
 * only true once we know the read is over.
 */
type PrivateLoader =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "failed" }>
  | Readonly<{ status: "loaded"; data: ExplorePrivatePayload }>;

function privateStateOf(loader: PrivateLoader): ExplorePrivateState {
  if (loader.status === "loaded") return "available";
  return loader.status === "failed" ? "unavailable" : "loading";
}

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

export function ExplorePageContent({ dashboard, library = emptyLibrary, userId, initialView, initialQuery = "", initialPack = null, initialSaved = false, initialFilter = "all" }: ExplorePageContentProps) {
  const resolvedInitialView = viewForLegacyState(initialView, initialPack, initialSaved, initialFilter);
  const resolvedInitialFilter = filterForView(resolvedInitialView, resolvedInitialView === "expressions" && initialSaved ? "saved" : initialFilter);
  const [view, setView] = useState<ExploreView>(resolvedInitialView);
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<ExploreLibraryFilter>(resolvedInitialFilter);
  const [selectedPack, setSelectedPack] = useState<string | null>(resolvedInitialView === "packs" ? initialPack : null);
  const [privateLoader, setPrivateLoader] = useState<PrivateLoader>({ status: "loading" });
  const [privateRequest, setPrivateRequest] = useState(0);
  const [generator, setGenerator] = useState<{ initialSource?: GeneratorSource } | null>(null);
  const generatorTrigger = useRef<HTMLButtonElement>(null);
  const generatorOpener = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Without a viewer there is nothing owned to read. With one, the request
    // starts after the public tree has painted; a late response from an
    // unmounted or replaced page is dropped.
    if (!userId) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]);
    void fetchPrivateExploreData(signal)
      .then((data) => { if (!signal.aborted) setPrivateLoader({ status: "loaded", data }); })
      .catch(() => { if (!controller.signal.aborted) setPrivateLoader({ status: "failed" }); });
    return () => controller.abort();
  }, [privateRequest, userId]);

  const privateState = privateStateOf(privateLoader);
  // The owned payload replaces the shell's bundle-only copy wholesale; a failed
  // read keeps the public catalogue exactly as the server sent it.
  const activeLibrary: ExploreLibraryDto = !userId ? library : privateLoader.status === "loaded"
    ? privateLoader.data.library
    : { ...library, privateState };
  const activeDashboard = privateLoader.status === "loaded" ? privateLoader.data.dashboard : dashboard;

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

  function selectView(nextView: string) {
    if (nextView !== "scenarios" && nextView !== "expressions" && nextView !== "packs") return;
    const nextFilter = filterForView(nextView, filter);
    setView(nextView);
    setFilter(nextFilter);
    if (nextView !== "packs") setSelectedPack(null);
    updateUrl({ view: nextView, filter: nextFilter, pack: nextView === "packs" ? selectedPack : null });
  }

  function searchScenarios(topic: string) {
    setView("scenarios");
    setQuery(topic);
    setFilter("all");
    setSelectedPack(null);
    updateUrl({ view: "scenarios", query: topic, filter: "all", pack: null });
    searchInput.current?.focus();
  }

  function refreshPrivateLibrary() {
    setPrivateRequest((current) => current + 1);
  }

  function openGenerator(trigger: HTMLButtonElement, initialSource?: GeneratorSource) {
    generatorOpener.current = trigger;
    setGenerator({ initialSource });
  }

  function closeGenerator() {
    setGenerator(null);
    const opener = generatorOpener.current;
    (opener?.isConnected ? opener : generatorTrigger.current)?.focus();
  }

  const searchLabel = view === "scenarios" ? "搜索场景" : view === "expressions" ? "搜索表达" : "搜索内容包";

  return (
    <Tabs className="page-stack explore-page" defaultValue="scenarios" value={view} onValueChange={selectView}>
      <h1 className="sr-only">探索场景</h1>
      <div className="explore-navigation">
        <TabsList className="explore-view-tabs" aria-label="探索内容">
          {views.map((item) => <TabsTrigger key={item.value} value={item.value}>{item.label}</TabsTrigger>)}
        </TabsList>
        <div className="explore-navigation__actions">
          <Link href="/explore/history" prefetch={false}>练习历史</Link>
          <button ref={generatorTrigger} type="button" aria-expanded={generator !== null} aria-controls={generator ? "explore-generator" : undefined} onClick={(event) => generator ? closeGenerator() : openGenerator(event.currentTarget)}>生成私人场景</button>
        </div>
      </div>
      {generator ? <PersonalScenarioGenerator
        key={generator.initialSource?.source.sourceId ?? "topic"}
        initialSource={generator.initialSource?.source}
        initialLabel={generator.initialSource?.label}
        onClose={closeGenerator}
        onCreated={refreshPrivateLibrary}
      /> : null}
      <div className="explore-discovery-controls">
        <div className="explore-intent" role="search" aria-label="按意图查找">
          <div className="explore-intent__field">
            <Input
              ref={searchInput}
              aria-label={searchLabel}
              type="search"
              value={query}
              onInput={(event) => {
                const query = event.currentTarget.value;
                setQuery(query);
                updateUrl({ query });
              }}
              placeholder={searchLabel}
            />
            {query
              ? <Button variant="quiet" size="sm" type="button" aria-label="清除搜索" onClick={() => { setQuery(""); updateUrl({ query: "" }); searchInput.current?.focus(); }}><CloseIcon /></Button>
              : <span aria-hidden="true"><SearchIcon /></span>}
          </div>
        </div>
        {view === "scenarios" ? <ScenarioSuggestionPanel onTopicSelected={searchScenarios} /> : null}
      </div>
      {views.map((item) => (
        <TabsContent key={item.value} value={item.value}>
          <ExploreLibraryPanel
            dashboard={activeDashboard}
            library={activeLibrary}
            view={item.value}
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
            onSaved={refreshPrivateLibrary}
            onUseExpression={(source, label, trigger) => openGenerator(trigger, { source, label })}
            onRetryPrivate={userId ? () => { setPrivateLoader({ status: "loading" }); refreshPrivateLibrary(); } : undefined}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
