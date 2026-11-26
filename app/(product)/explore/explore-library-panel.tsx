"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ExploreDashboardDto, ExploreCardDto } from "@/src/modules/explore/domain";
import { useReadAloud } from "@/src/modules/providers/tts/use-read-aloud";
import { Button } from "@/src/shared/ui/primitives";
import {
  filterExploreLibrary,
  normalizeExploreSearchText,
  type ExploreExpressionLibraryCard,
  type ExploreExpressionGenerationSource,
  type ExploreLibraryDto,
  type ExploreLibraryFilter,
  type ExplorePrivateState,
} from "@/src/modules/explore/domain/explore-library";

import { ExploreExpressionSaveButton } from "./explore-expression-save-button";

type ExploreView = "scenarios" | "expressions" | "packs";

/**
 * `owned` marks the filters whose result can only be computed from the user's
 * own rows. While those rows are still in flight, an empty list under such a
 * filter means "not read yet", not "you have nothing saved".
 */
const scenarioFilterChoices = [
  { value: "all", label: "全部场景", owned: false },
  { value: "available", label: "可立即开始", owned: false },
] as const;

const expressionFilterChoices = [
  { value: "all", label: "全部表达", owned: false },
  { value: "formal", label: "正式表达", owned: false },
  { value: "saved", label: "我的收藏", owned: true },
  { value: "reading", label: "阅读来源", owned: true },
  { value: "recent-error", label: "近期难点", owned: true },
] as const;

const packFilterChoices = [
  { value: "all", label: "全部内容包", owned: false },
  // `route` is decided by the pack's published status, which is catalogue data;
  // only the saved flag comes from the user's own rows.
  { value: "available", label: "可打开", owned: false },
  { value: "saved", label: "已收藏", owned: true },
] as const;

/**
 * Only a failed owned-read is worth a notice. While those rows are still in
 * flight the public catalogue stands on its own without an announcement, and
 * the filters that cannot be answered yet show `privateFilterPending` instead.
 */
const privateNotice: Readonly<Partial<Record<ExplorePrivateState, string>>> = {
  unavailable: "私人内容暂不可用，当前显示公共内容。",
};

/** The placeholder shown when the active filter needs rows that have not arrived. */
const privateFilterPending: Readonly<Record<ExploreView, string>> = {
  scenarios: "正在加载你的场景…",
  expressions: "正在加载你的收藏与阅读来源…",
  packs: "正在加载你的内容包状态…",
};

const skillLabels: Readonly<Record<ExploreCardDto["skills"][number], string>> = {
  listen: "听力",
  read: "阅读",
  speak: "口语",
  write: "写作",
};

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
}

function SpeakerIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3Zm13 0a4 4 0 0 1 0 6m3-9a8 8 0 0 1 0 12" /></svg>;
}

function sourceLabel(item: ExploreExpressionLibraryCard): string {
  if (item.sourceKind === "formal") return "正式表达";
  if (item.sourceKind === "saved") return "我的收藏";
  if (item.sourceKind === "reading") return "阅读来源";
  return "近期难点";
}

function matchesPack(pack: ExploreCardDto, query: string): boolean {
  const tokens = normalizeExploreSearchText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeExploreSearchText([
    pack.title,
    pack.summary,
    pack.level,
    pack.source?.title,
    ...pack.skills.map((skill) => skillLabels[skill]),
  ].filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

function PackCard({ pack, selected, onSelect }: Readonly<{ pack: ExploreCardDto; selected: boolean; onSelect: () => void }>) {
  const progress = pack.progress ? `${pack.progress.completedSteps}/${pack.progress.totalSteps}` : null;
  const status = pack.status === "in_progress" ? "进行中" : pack.status === "draft" ? "草稿预览" : pack.status === "unavailable" ? "暂不可用" : "可开始";
  const body = <><div className="explore-pack-card__art"><span>{pack.level} · {pack.version}</span><strong>{pack.skills.map((skill) => skillLabels[skill]).join(" / ")}</strong></div><div className="explore-pack-card__body"><div className="explore-pack-card__meta"><span>{pack.durationLabel}</span><span>{pack.saved ? "已收藏" : status}</span></div><h3>{pack.title}</h3><p>{pack.summary}</p><div className="explore-pack-card__footer"><span>{pack.source?.title ?? "Sueño 内容"}</span><span>{progress ? `进度 ${progress}` : status}</span></div></div></>;
  const className = `explore-pack-card${selected ? " is-selected" : ""}`;
  return pack.route
    ? <a className={className} data-status={pack.status} href={pack.route} aria-current={selected ? "true" : undefined} onClick={onSelect}>{body}</a>
    : <article className={className} data-status={pack.status} data-unavailable="true">{body}</article>;
}

export function ExploreLibraryPanel({ dashboard, library, view, query, filter, selectedPack, onFilterChange, onPackSelected, onClear, onSaved, onUseExpression, onRetryPrivate }: Readonly<{
  dashboard: ExploreDashboardDto;
  library: ExploreLibraryDto;
  view: ExploreView;
  query: string;
  filter: ExploreLibraryFilter;
  selectedPack: string | null;
  onFilterChange: (filter: ExploreLibraryFilter) => void;
  onPackSelected: (stableKey: string | null) => void;
  onClear: () => void;
  onSaved?: () => void;
  onUseExpression?: (source: ExploreExpressionGenerationSource, label: string, trigger: HTMLButtonElement) => void;
  onRetryPrivate?: () => void;
}>) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryState, setCategoryState] = useState({ key: "", value: "all" });
  const [visibleState, setVisibleState] = useState({ key: "", count: 12 });
  const [speechUnsupported, setSpeechUnsupported] = useState(false);
  const speech = useReadAloud();
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const filterPanel = useRef<HTMLDivElement | null>(null);
  const resetKey = `${view}:${query}:${filter}`;
  const category = categoryState.key === resetKey ? categoryState.value : "all";
  const visibleExpressionCount = visibleState.key === resetKey ? visibleState.count : 12;
  const filtered = useMemo(() => filterExploreLibrary(library, { query, filter }), [filter, library, query]);
  const scenarios = useMemo(() => filtered.scenarios.filter((item) => category === "all" || item.category === category), [category, filtered.scenarios]);
  const expressions = useMemo(() => filtered.expressions.filter((item) => category === "all" || item.category === category), [category, filtered.expressions]);
  const packs = useMemo(() => dashboard.packs
    .filter((pack) => matchesPack(pack, query))
    .filter((pack) => filter === "saved" ? pack.saved === true : filter === "available" ? Boolean(pack.route) : true), [dashboard.packs, filter, query]);
  const categories = useMemo(() => {
    const items = view === "expressions" ? library.expressions : library.scenarios;
    return [...new Map(items.map((item) => [item.category, item.categoryLabel])).entries()];
  }, [library.expressions, library.scenarios, view]);
  const relatedScenarios = useMemo(() => {
    const routes = new Map<string, string>();
    if (view !== "expressions") return routes;
    for (const scenario of library.scenarios) {
      for (const expression of scenario.expressionTexts) {
        const key = normalizeExploreSearchText(expression);
        if (key && !routes.has(key)) routes.set(key, scenario.route);
      }
    }
    return routes;
  }, [library.scenarios, view]);
  const choices = view === "scenarios" ? scenarioFilterChoices : view === "expressions" ? expressionFilterChoices : packFilterChoices;
  const ownedFilter = choices.find((choice) => choice.value === filter)?.owned === true;
  const privatePending = library.privateState === "loading" && ownedFilter;
  const privateUnavailable = library.privateState === "unavailable" && ownedFilter;
  const activeFilterLabel = choices.find((choice) => choice.value === filter)?.label;
  const count = view === "scenarios" ? scenarios.length : view === "expressions" ? expressions.length : packs.length;
  const countLabel = view === "scenarios" ? `${count} 个场景` : view === "expressions" ? `${count} 条表达` : `${count} 个内容包`;
  const filterLabel = view === "scenarios" ? "筛选场景" : view === "expressions" ? "筛选表达" : "筛选内容包";
  const filterDialogLabel = view === "scenarios" ? "场景筛选" : view === "expressions" ? "表达筛选" : "内容包筛选";

  function closeAndRestoreFocus() {
    setFiltersOpen(false);
    filterTrigger.current?.focus();
  }

  useEffect(() => {
    if (!filtersOpen) return;
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") closeAndRestoreFocus(); }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!filterPanel.current?.contains(target) && !filterTrigger.current?.contains(target)) closeAndRestoreFocus();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [filtersOpen]);

  function selectFilter(nextFilter: ExploreLibraryFilter) {
    onFilterChange(nextFilter);
    closeAndRestoreFocus();
  }

  function selectCategory(value: string) {
    setCategoryState({ key: resetKey, value });
    closeAndRestoreFocus();
  }

  function playExpression(expression: ExploreExpressionLibraryCard) {
    setSpeechUnsupported(false);
    if (speech.speakingId === expression.id) { speech.stop(); return; }
    speech.speak(expression.id, expression.text, () => setSpeechUnsupported(true));
  }

  return <section className="explore-library">
    <div className="explore-library__toolbar">
      <span className="explore-library__count" role="status" aria-live="polite">{countLabel}</span>
      <div className="explore-library__filter-wrap">
        <Button ref={filterTrigger} variant="secondary" className="explore-library__filter-trigger" type="button" aria-expanded={filtersOpen} aria-controls="explore-library-filters" aria-label={filterLabel} onClick={() => setFiltersOpen((open) => !open)}><FilterIcon /><span>筛选</span></Button>
        {filtersOpen ? <div ref={filterPanel} id="explore-library-filters" className="explore-library__filter-panel" role="dialog" aria-label={filterDialogLabel}>
          <div><strong>{view === "expressions" ? "来源" : "状态"}</strong>{choices.map((choice) => <Button variant="quiet" size="sm" type="button" key={choice.value} aria-pressed={filter === choice.value} onClick={() => selectFilter(choice.value)}>{choice.label}</Button>)}</div>
          {view !== "packs" && categories.length > 0 ? <div><strong>沟通主题</strong>{categories.map(([value, label]) => <Button variant="quiet" size="sm" type="button" key={value} aria-pressed={category === value} onClick={() => selectCategory(value)}>{label}</Button>)}</div> : null}
        </div> : null}
      </div>
    </div>
    {filter !== "all" || category !== "all" ? <div className="explore-library__active-filters" aria-label="已选筛选">{filter !== "all" ? <Button variant="quiet" size="sm" type="button" onClick={() => onFilterChange("all")}>{activeFilterLabel} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></Button> : null}{category !== "all" ? <Button variant="quiet" size="sm" type="button" onClick={() => setCategoryState({ key: resetKey, value: "all" })}>{categories.find(([value]) => value === category)?.[1]} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></Button> : null}</div> : null}
    {privateNotice[library.privateState] ? <div className="explore-private-state">
      <p className="explore-library__private-note" role="status">{privateUnavailable ? "私人内容暂不可用。" : privateNotice[library.privateState]}</p>
      {onRetryPrivate ? <Button variant="quiet" size="sm" type="button" onClick={onRetryPrivate}>重试加载</Button> : null}
    </div> : null}

    {view === "scenarios" ? privatePending
      ? <div className="explore-empty explore-library__empty" role="status"><strong>{privateFilterPending.scenarios}</strong></div>
      : scenarios.length === 0
        ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的场景</strong><Button onClick={onClear}>清除搜索和筛选</Button></div>
        : <div className="explore-scenario-grid">{scenarios.map((scenario) => <Link href={scenario.route} key={scenario.stableKey}><div><small>{scenario.cefr} · {scenario.role}{scenario.sourceKind === "personal" ? " · 私人" : ""}</small><h3>{scenario.title}</h3><span className="explore-scenario-card__goal">{scenario.communicationGoal.replace(/([。！？])；/gu, "$1 ")}</span></div><span aria-hidden="true">→</span></Link>)}</div>
      : null}

    {view === "expressions" && !privateUnavailable ? privatePending
      ? <div className="explore-empty explore-library__empty" role="status"><strong>{privateFilterPending.expressions}</strong></div>
      : expressions.length === 0
        ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的表达</strong><Button onClick={onClear}>清除搜索和筛选</Button></div>
        : <>
          {speech.errorMessage || speechUnsupported ? <p role="status">{speech.errorMessage || "当前浏览器无法朗读。"}</p> : null}
          <ul className="explore-expression-list">
            {expressions.slice(0, visibleExpressionCount).map((expression) => {
              const scenarioRoute = relatedScenarios.get(normalizeExploreSearchText(expression.text));
              const generationSource = expression.generationSource;
              const speaking = speech.speakingId === expression.id;
              return <li key={expression.id}><article className="explore-expression-card">
                <div className="explore-expression-card__copy">
                  <div className="explore-expression-card__meta">
                    <span>{sourceLabel(expression)}</span>
                    {expression.cefr ? <span>{expression.cefr}</span> : null}
                    {expression.region ? <span>{expression.region}</span> : null}
                    {expression.categoryLabel !== sourceLabel(expression) ? <span>{expression.categoryLabel}</span> : null}
                  </div>
                  <h3 lang="es">{expression.text}</h3>
                  {expression.translation ? <p>{expression.translation}</p> : null}
                  {expression.intent ? <small>{expression.intent}</small> : null}
                  {scenarioRoute ? <Link className="explore-expression-scenario" href={scenarioRoute}>进入关联场景 <span aria-hidden="true">→</span></Link>
                    : generationSource && onUseExpression ? <Button variant="quiet" className="explore-expression-scenario" type="button" onClick={(event) => onUseExpression(generationSource, expression.text, event.currentTarget)}>用这句生成场景</Button>
                    : null}
                </div>
                <div className="explore-expression-tools">
                  <Button variant="quiet" type="button" aria-label={`${speaking ? "停止朗读" : "朗读表达"}：${expression.text}`} aria-pressed={speaking} onClick={() => playExpression(expression)}><SpeakerIcon /></Button>
                  {expression.saved || expression.saveSource ? <ExploreExpressionSaveButton expressionText={expression.text} initiallySaved={expression.saved} source={expression.saveSource} onSaved={onSaved} /> : null}
                </div>
              </article></li>;
            })}
          </ul>
          {visibleExpressionCount < expressions.length ? <Button variant="secondary" className="explore-library__more" type="button" onClick={() => setVisibleState({ key: resetKey, count: visibleExpressionCount + 12 })}>显示更多</Button> : null}
        </>
      : null}

    {view === "packs" && !privateUnavailable ? privatePending
      ? <div className="explore-empty explore-library__empty" role="status"><strong>{privateFilterPending.packs}</strong></div>
      : packs.length === 0
        ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的内容包</strong><Button onClick={onClear}>清除搜索和筛选</Button></div>
        : <div className="explore-pack-grid">{packs.map((pack) => <PackCard key={pack.id} pack={pack} selected={pack.stableKey === selectedPack} onSelect={() => onPackSelected(pack.stableKey)} />)}</div>
      : null}
  </section>;
}
