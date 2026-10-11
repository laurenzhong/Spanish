"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ExploreDashboardDto, ExploreCardDto } from "@/src/modules/explore/domain";
import {
  filterExploreLibrary,
  normalizeExploreSearchText,
  type ExploreExpressionLibraryCard,
  type ExploreLibraryDto,
  type ExploreLibraryFilter,
} from "@/src/modules/explore/domain/explore-library";

import { ExploreExpressionSaveButton } from "./explore-expression-save-button";

type ExploreView = "scenarios" | "expressions" | "packs";

const scenarioFilterChoices = [
  { value: "all", label: "全部场景" },
  { value: "available", label: "可立即开始" },
] as const;

const expressionFilterChoices = [
  { value: "all", label: "全部表达" },
  { value: "formal", label: "正式表达" },
  { value: "saved", label: "我的收藏" },
  { value: "reading", label: "阅读来源" },
  { value: "recent-error", label: "近期难点" },
] as const;

const packFilterChoices = [
  { value: "all", label: "全部内容包" },
  { value: "available", label: "可打开" },
  { value: "saved", label: "已收藏" },
] as const;

const skillLabels: Readonly<Record<ExploreCardDto["skills"][number], string>> = {
  listen: "听力",
  read: "阅读",
  speak: "口语",
  write: "写作",
};

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
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

export function ExploreLibraryPanel({ dashboard, library, view, query, filter, selectedPack, onFilterChange, onPackSelected, onClear }: Readonly<{
  dashboard: ExploreDashboardDto;
  library: ExploreLibraryDto;
  view: ExploreView;
  query: string;
  filter: ExploreLibraryFilter;
  selectedPack: string | null;
  onFilterChange: (filter: ExploreLibraryFilter) => void;
  onPackSelected: (stableKey: string | null) => void;
  onClear: () => void;
}>) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryState, setCategoryState] = useState({ key: "", value: "all" });
  const [visibleState, setVisibleState] = useState({ key: "", count: 12 });
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
  const choices = view === "scenarios" ? scenarioFilterChoices : view === "expressions" ? expressionFilterChoices : packFilterChoices;
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

  return <section id={`explore-panel-${view}`} className="explore-library" role="tabpanel" aria-labelledby={`explore-tab-${view}`}>
    <div className="explore-library__toolbar">
      <span className="explore-library__count" role="status" aria-live="polite">{countLabel}</span>
      <div className="explore-library__filter-wrap">
        <button ref={filterTrigger} className="explore-library__filter-trigger" type="button" aria-expanded={filtersOpen} aria-controls="explore-library-filters" aria-label={filterLabel} onClick={() => setFiltersOpen((open) => !open)}><FilterIcon /><span>筛选</span></button>
        {filtersOpen ? <div ref={filterPanel} id="explore-library-filters" className="explore-library__filter-panel" role="dialog" aria-label={filterDialogLabel}>
          <div><strong>{view === "expressions" ? "来源" : "状态"}</strong>{choices.map((choice) => <button type="button" key={choice.value} aria-pressed={filter === choice.value} onClick={() => selectFilter(choice.value)}>{choice.label}</button>)}</div>
          {view !== "packs" && categories.length > 0 ? <div><strong>沟通主题</strong>{categories.map(([value, label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => selectCategory(value)}>{label}</button>)}</div> : null}
        </div> : null}
      </div>
    </div>
    {filter !== "all" || category !== "all" ? <div className="explore-library__active-filters" aria-label="已选筛选">{filter !== "all" ? <button type="button" onClick={() => onFilterChange("all")}>{activeFilterLabel} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}{category !== "all" ? <button type="button" onClick={() => setCategoryState({ key: resetKey, value: "all" })}>{categories.find(([value]) => value === category)?.[1]} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}</div> : null}
    {library.privateState === "unavailable" && view !== "packs" ? <p className="explore-library__private-note" role="status">私人内容暂不可用，当前显示公共内容。</p> : null}

    {view === "scenarios" ? scenarios.length === 0
      ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的场景</strong><button type="button" onClick={onClear}>清除搜索和筛选</button></div>
      : <div className="explore-scenario-grid">{scenarios.map((scenario) => <Link href={scenario.route} key={scenario.stableKey}><div><small>{scenario.cefr} · {scenario.role}{scenario.sourceKind === "personal" ? " · 私人" : ""}</small><h3>{scenario.title}</h3><span className="explore-scenario-card__goal">{scenario.communicationGoal}</span></div><span aria-hidden="true">→</span></Link>)}</div>
      : null}

    {view === "expressions" ? expressions.length === 0
      ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的表达</strong><button type="button" onClick={onClear}>清除搜索和筛选</button></div>
      : <><ul className="explore-expression-list">{expressions.slice(0, visibleExpressionCount).map((expression) => <li key={expression.id}><article className="explore-expression-card"><div className="explore-expression-card__copy"><div className="explore-expression-card__meta"><span>{sourceLabel(expression)}</span>{expression.cefr ? <span>{expression.cefr}</span> : null}{expression.region ? <span>{expression.region}</span> : null}<span>{expression.categoryLabel}</span></div><h3 lang="es">{expression.text}</h3>{expression.translation ? <p>{expression.translation}</p> : null}{expression.intent ? <small>{expression.intent}</small> : null}</div>{expression.saved || expression.saveSource ? <ExploreExpressionSaveButton expressionText={expression.text} initiallySaved={expression.saved} source={expression.saveSource} /> : null}</article></li>)}</ul>{visibleExpressionCount < expressions.length ? <button className="explore-library__more" type="button" onClick={() => setVisibleState({ key: resetKey, count: visibleExpressionCount + 12 })}>显示更多</button> : null}</>
      : null}

    {view === "packs" ? packs.length === 0
      ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的内容包</strong><button type="button" onClick={onClear}>清除搜索和筛选</button></div>
      : <div className="explore-pack-grid">{packs.map((pack) => <PackCard key={pack.id} pack={pack} selected={pack.stableKey === selectedPack} onSelect={() => onPackSelected(pack.stableKey)} />)}</div>
      : null}
  </section>;
}
