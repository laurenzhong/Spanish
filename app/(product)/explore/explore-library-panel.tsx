"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  filterExploreLibrary,
  type ExploreExpressionGenerationSource,
  type ExploreExpressionLibraryCard,
  type ExploreLibraryDto,
  type ExploreLibraryFilter,
} from "@/src/modules/explore/domain/explore-library";

import { PersonalScenarioGenerator } from "./personal-scenario-generator";

export type ExploreLibraryView = "scenarios" | "expressions";

const filterChoices: Record<ExploreLibraryView, readonly Readonly<{ value: ExploreLibraryFilter; label: string }>[]> = {
  scenarios: [{ value: "all", label: "全部" }, { value: "available", label: "可立即开始" }],
  expressions: [{ value: "all", label: "全部" }, { value: "saved", label: "已收藏" }, { value: "recent-error", label: "最近错误" }, { value: "reading", label: "阅读来源" }],
};

type SavedOverride = Readonly<{ saved: boolean; savedExpressionId?: string }>;

function sourceLabel(sourceKind: ExploreExpressionLibraryCard["sourceKind"]): string {
  if (sourceKind === "formal") return "正式表达";
  if (sourceKind === "saved") return "我的收藏";
  if (sourceKind === "reading") return "阅读选区";
  return "近期难点";
}

function BookmarkIcon({ filled = false }: Readonly<{ filled?: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.2-5 3.2z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function SparkIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5zM18 16l.7 2.3L21 19l-2.3.7L18 22l-.7-2.3L15 19l2.3-.7z" /></svg>;
}

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
}

export function ExploreLibraryPanel({ library, query, filter, view, onFilterChange, onClear }: Readonly<{
  library: ExploreLibraryDto;
  query: string;
  filter: ExploreLibraryFilter;
  view: ExploreLibraryView;
  onFilterChange: (filter: ExploreLibraryFilter) => void;
  onClear: () => void;
}>) {
  const [savedOverrides, setSavedOverrides] = useState<Record<string, SavedOverride>>({});
  const [busyExpressionId, setBusyExpressionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Readonly<{ source: ExploreExpressionGenerationSource; label: string; key: number }> | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryState, setCategoryState] = useState({ key: "", value: "all" });
  const [visibleExpressionState, setVisibleExpressionState] = useState({ key: "", count: 12 });
  const generationTrigger = useRef<HTMLButtonElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const filterPanel = useRef<HTMLDivElement | null>(null);

  const effectiveLibrary = useMemo<ExploreLibraryDto>(() => ({
    ...library,
    expressions: library.expressions.map((expression) => {
      const override = savedOverrides[expression.id];
      return override ? { ...expression, ...override } : expression;
    }),
  }), [library, savedOverrides]);
  const resetKey = `${view}:${query}:${filter}`;
  const category = categoryState.key === resetKey ? categoryState.value : "all";
  const visibleExpressionCount = visibleExpressionState.key === resetKey ? visibleExpressionState.count : 12;
  const results = useMemo(() => {
    const filtered = filterExploreLibrary(effectiveLibrary, { query, filter });
    return {
      scenarios: filtered.scenarios.filter((item) => category === "all" || item.category === category),
      expressions: filtered.expressions.filter((item) => category === "all" || item.category === category),
    };
  }, [category, effectiveLibrary, filter, query]);
  const categories = useMemo(() => {
    const items = view === "scenarios" ? effectiveLibrary.scenarios : effectiveLibrary.expressions.filter((item) => item.sourceKind === "formal");
    return [...new Map(items.map((item) => [item.category, item.categoryLabel])).entries()];
  }, [effectiveLibrary, view]);
  const total = view === "scenarios" ? results.scenarios.length : results.expressions.length;
  const visibleExpressions = results.expressions.slice(0, visibleExpressionCount);
  const activeFilterLabel = filterChoices[view].find((choice) => choice.value === filter)?.label;

  useEffect(() => {
    if (!filtersOpen) return;
    function closeAndRestoreFocus() {
      setFiltersOpen(false);
      window.requestAnimationFrame(() => filterTrigger.current?.focus());
    }
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") closeAndRestoreFocus(); }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!filterPanel.current?.contains(target) && !filterTrigger.current?.contains(target)) setFiltersOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [filtersOpen]);

  async function toggleSaved(expression: ExploreExpressionLibraryCard) {
    const effective = savedOverrides[expression.id] ? { ...expression, ...savedOverrides[expression.id] } : expression;
    if (busyExpressionId || (!effective.saved && !effective.saveSource) || (effective.saved && !effective.savedExpressionId)) return;
    setBusyExpressionId(expression.id);
    setNotice(null);
    try {
      const response = effective.saved
        ? await fetch(`/api/v1/expressions/saved/${encodeURIComponent(effective.savedExpressionId!)}`, { method: "DELETE", credentials: "same-origin" })
        : await fetch("/api/v1/expressions/saved", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientSaveId: `explore-${crypto.randomUUID()}`, source: effective.saveSource }) });
      const payload = await response.json().catch(() => null) as { data?: { id?: string } } | null;
      if (!response.ok || (!effective.saved && !payload?.data?.id)) throw new Error("SAVE_FAILED");
      setSavedOverrides((current) => ({ ...current, [expression.id]: effective.saved ? { saved: false } : { saved: true, savedExpressionId: payload!.data!.id! } }));
      setNotice(effective.saved ? "已取消收藏。" : "已收藏表达，不会产生学习证据。");
    } catch {
      setNotice(effective.saved ? "暂时无法取消收藏，请重试。" : "暂时无法收藏表达，请重试。");
    } finally { setBusyExpressionId(null); }
  }

  function startGeneration(expression: ExploreExpressionLibraryCard, button: HTMLButtonElement) {
    const override = savedOverrides[expression.id];
    const source = expression.generationSource ?? (override?.savedExpressionId ? { sourceType: "saved-expression" as const, sourceId: override.savedExpressionId } : null);
    if (!source) return;
    generationTrigger.current = button;
    setGeneration({ source, label: expression.text, key: Date.now() });
  }

  function closeGeneration() {
    setGeneration(null);
    window.requestAnimationFrame(() => generationTrigger.current?.focus());
  }

  function selectFilter(nextFilter: ExploreLibraryFilter) {
    onFilterChange(nextFilter);
    setFiltersOpen(false);
    window.requestAnimationFrame(() => filterTrigger.current?.focus());
  }

  const viewName = view === "scenarios" ? "场景" : "表达";
  const countLabel = view === "scenarios" ? `${total} 个场景` : `${total} 条表达`;

  return <section className="explore-library" aria-label={`${viewName}结果`}>
    <div className="explore-library__toolbar">
      <span role="status" aria-live="polite">{countLabel}</span>
      <div className="explore-library__filter-wrap">
        <button ref={filterTrigger} className="explore-library__filter-trigger" type="button" aria-expanded={filtersOpen} aria-controls="explore-library-filters" aria-label={`筛选${viewName}`} onClick={() => setFiltersOpen((open) => !open)}><FilterIcon /><span>筛选</span></button>
        {filtersOpen ? <div ref={filterPanel} id="explore-library-filters" className="explore-library__filter-panel" role="dialog" aria-label={`${viewName}筛选`}>
          <div><strong>来源与状态</strong>{filterChoices[view].map((choice) => <button type="button" key={choice.value} aria-pressed={filter === choice.value} onClick={() => selectFilter(choice.value)}>{choice.label}</button>)}</div>
          {categories.length > 0 ? <div><strong>沟通主题</strong>{categories.map(([value, label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategoryState({ key: resetKey, value }); setFiltersOpen(false); window.requestAnimationFrame(() => filterTrigger.current?.focus()); }}>{label}</button>)}</div> : null}
        </div> : null}
      </div>
    </div>
    {filter !== "all" || category !== "all" ? <div className="explore-library__active-filters" aria-label="已选筛选">{filter !== "all" ? <button type="button" onClick={() => onFilterChange("all")}>{activeFilterLabel} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}{category !== "all" ? <button type="button" onClick={() => setCategoryState({ key: resetKey, value: "all" })}>{categories.find(([value]) => value === category)?.[1]} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}</div> : null}
    {library.privateState === "unavailable" ? <p className="explore-library__private-note" role="status">私人资料暂不可用，当前显示公共内容。</p> : null}
    {total === 0 ? <div className="explore-empty explore-library__empty" role="status"><strong>{`没有匹配的${viewName}`}</strong><button type="button" onClick={onClear}>清除搜索和筛选</button></div>
      : view === "scenarios" ? <div className="explore-scenario-grid">{results.scenarios.map((scenario) => <a href={scenario.route} key={scenario.stableKey}><div><small>{scenario.cefr} · {scenario.role}{scenario.sourceKind === "personal" ? " · 私人" : ""}</small><h3>{scenario.title}</h3><span className="explore-scenario-card__goal">{scenario.communicationGoal}</span></div><span aria-hidden="true">→</span></a>)}</div>
        : <div className="explore-expression-list">{visibleExpressions.map((expression) => {
          const override = savedOverrides[expression.id];
          const effective = override ? { ...expression, ...override } : expression;
          const canGenerate = Boolean(expression.generationSource || override?.savedExpressionId);
          return <article className="explore-expression-card" key={expression.id}><div className="explore-expression-card__copy"><div className="explore-expression-card__meta"><span>{sourceLabel(expression.sourceKind)}</span><span>{expression.cefr ?? expression.categoryLabel}</span>{expression.region ? <span>{expression.region}</span> : null}</div><h4 lang="es">{expression.text}</h4>{expression.translation ? <p>{expression.translation}</p> : null}</div><div className="explore-expression-card__actions">{effective.saved || effective.saveSource ? <button type="button" disabled={busyExpressionId === expression.id} aria-label={`${busyExpressionId === expression.id ? "正在保存" : effective.saved ? "取消收藏" : "收藏表达"}：${expression.text}`} aria-pressed={effective.saved} onClick={() => void toggleSaved(expression)}><BookmarkIcon filled={effective.saved} /></button> : null}{canGenerate ? <button type="button" aria-label={`用此表达生成场景：${expression.text}`} onClick={(event) => startGeneration(expression, event.currentTarget)}><SparkIcon /></button> : null}</div></article>;
        })}{visibleExpressionCount < results.expressions.length ? <button className="explore-library__more" type="button" onClick={() => setVisibleExpressionState({ key: resetKey, count: visibleExpressionCount + 12 })}>显示更多表达</button> : null}</div>}
    {notice ? <p className="explore-library__notice" role="status">{notice}</p> : null}
    {generation ? <PersonalScenarioGenerator key={generation.key} initialSource={generation.source} initialLabel={generation.label} onClose={closeGeneration} /> : null}
  </section>;
}
