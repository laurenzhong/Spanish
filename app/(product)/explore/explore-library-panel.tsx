"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  filterExploreLibrary,
  type ExploreLibraryDto,
  type ExploreLibraryFilter,
} from "@/src/modules/explore/domain/explore-library";

const filterChoices = [
  { value: "all", label: "全部" },
  { value: "available", label: "可立即开始" },
] as const;

function FilterIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>;
}

export function ExploreLibraryPanel({ library, query, filter, onFilterChange, onClear }: Readonly<{
  library: ExploreLibraryDto;
  query: string;
  filter: ExploreLibraryFilter;
  onFilterChange: (filter: ExploreLibraryFilter) => void;
  onClear: () => void;
}>) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoryState, setCategoryState] = useState({ key: "", value: "all" });
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const filterPanel = useRef<HTMLDivElement | null>(null);
  const resetKey = `${query}:${filter}`;
  const category = categoryState.key === resetKey ? categoryState.value : "all";
  const scenarios = useMemo(() => filterExploreLibrary(library, { query, filter }).scenarios
    .filter((item) => category === "all" || item.category === category), [category, filter, library, query]);
  const categories = useMemo(() => [...new Map(library.scenarios.map((item) => [item.category, item.categoryLabel])).entries()], [library.scenarios]);
  const activeFilterLabel = filterChoices.find((choice) => choice.value === filter)?.label;

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

  function selectFilter(nextFilter: ExploreLibraryFilter) {
    onFilterChange(nextFilter);
    setFiltersOpen(false);
    window.requestAnimationFrame(() => filterTrigger.current?.focus());
  }

  return <section className="explore-library" aria-label="场景结果">
    <div className="explore-library__toolbar">
      <span role="status" aria-live="polite">{scenarios.length} 个场景</span>
      <div className="explore-library__filter-wrap">
        <button ref={filterTrigger} className="explore-library__filter-trigger" type="button" aria-expanded={filtersOpen} aria-controls="explore-library-filters" aria-label="筛选场景" onClick={() => setFiltersOpen((open) => !open)}><FilterIcon /><span>筛选</span></button>
        {filtersOpen ? <div ref={filterPanel} id="explore-library-filters" className="explore-library__filter-panel" role="dialog" aria-label="场景筛选">
          <div><strong>状态</strong>{filterChoices.map((choice) => <button type="button" key={choice.value} aria-pressed={filter === choice.value} onClick={() => selectFilter(choice.value)}>{choice.label}</button>)}</div>
          {categories.length > 0 ? <div><strong>沟通主题</strong>{categories.map(([value, label]) => <button type="button" key={value} aria-pressed={category === value} onClick={() => { setCategoryState({ key: resetKey, value }); setFiltersOpen(false); window.requestAnimationFrame(() => filterTrigger.current?.focus()); }}>{label}</button>)}</div> : null}
        </div> : null}
      </div>
    </div>
    {filter !== "all" || category !== "all" ? <div className="explore-library__active-filters" aria-label="已选筛选">{filter !== "all" ? <button type="button" onClick={() => onFilterChange("all")}>{activeFilterLabel} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}{category !== "all" ? <button type="button" onClick={() => setCategoryState({ key: resetKey, value: "all" })}>{categories.find(([value]) => value === category)?.[1]} <span aria-hidden="true">×</span><span className="sr-only">，移除筛选</span></button> : null}</div> : null}
    {library.privateState === "unavailable" ? <p className="explore-library__private-note" role="status">私人场景暂不可用，当前显示公共场景。</p> : null}
    {scenarios.length === 0
      ? <div className="explore-empty explore-library__empty" role="status"><strong>没有匹配的场景</strong><button type="button" onClick={onClear}>清除搜索和筛选</button></div>
      : <div className="explore-scenario-grid">{scenarios.map((scenario) => <a href={scenario.route} key={scenario.stableKey}><div><small>{scenario.cefr} · {scenario.role}{scenario.sourceKind === "personal" ? " · 私人" : ""}</small><h3>{scenario.title}</h3><span className="explore-scenario-card__goal">{scenario.communicationGoal}</span></div><span aria-hidden="true">→</span></a>)}</div>}
  </section>;
}
