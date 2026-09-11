"use client";

import { useMemo, useRef, useState } from "react";

import {
  filterExploreLibrary,
  type ExploreExpressionGenerationSource,
  type ExploreExpressionLibraryCard,
  type ExploreLibraryDto,
  type ExploreLibraryFilter,
} from "@/src/modules/explore/domain/explore-library";

import { PersonalScenarioGenerator } from "./personal-scenario-generator";

const filterChoices: readonly Readonly<{ value: ExploreLibraryFilter; label: string; hint: string }>[] = [
  { value: "all", label: "全部", hint: "场景与表达" },
  { value: "saved", label: "已收藏", hint: "主动保存" },
  { value: "recent-error", label: "最近错误", hint: "可信问题" },
  { value: "reading", label: "阅读来源", hint: "本人选区" },
  { value: "available", label: "可立即开始", hint: "完整场景" },
];

type SavedOverride = Readonly<{ saved: boolean; savedExpressionId?: string }>;

function sourceLabel(sourceKind: ExploreExpressionLibraryCard["sourceKind"]): string {
  if (sourceKind === "formal") return "正式表达";
  if (sourceKind === "saved") return "我的收藏";
  if (sourceKind === "reading") return "阅读选区";
  return "近期难点";
}

export function ExploreLibraryPanel({
  library,
  query,
  filter,
  onFilterChange,
  onClear,
}: Readonly<{
  library: ExploreLibraryDto;
  query: string;
  filter: ExploreLibraryFilter;
  onFilterChange: (filter: ExploreLibraryFilter) => void;
  onClear: () => void;
}>) {
  const [savedOverrides, setSavedOverrides] = useState<Record<string, SavedOverride>>({});
  const [busyExpressionId, setBusyExpressionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generation, setGeneration] = useState<Readonly<{ source: ExploreExpressionGenerationSource; label: string; key: number }> | null>(null);
  const generationTrigger = useRef<HTMLButtonElement | null>(null);

  const effectiveLibrary = useMemo<ExploreLibraryDto>(() => ({
    ...library,
    expressions: library.expressions.map((expression) => {
      const override = savedOverrides[expression.id];
      return override ? { ...expression, ...override } : expression;
    }),
  }), [library, savedOverrides]);
  const results = useMemo(() => filterExploreLibrary(effectiveLibrary, { query, filter }), [effectiveLibrary, filter, query]);
  const total = results.scenarios.length + results.expressions.length;

  async function toggleSaved(expression: ExploreExpressionLibraryCard) {
    const effective = savedOverrides[expression.id] ? { ...expression, ...savedOverrides[expression.id] } : expression;
    if (busyExpressionId || (!effective.saved && !effective.saveSource) || (effective.saved && !effective.savedExpressionId)) return;
    setBusyExpressionId(expression.id);
    setNotice(null);
    try {
      const response = effective.saved
        ? await fetch(`/api/v1/expressions/saved/${encodeURIComponent(effective.savedExpressionId!)}`, { method: "DELETE", credentials: "same-origin" })
        : await fetch("/api/v1/expressions/saved", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ clientSaveId: `explore-${crypto.randomUUID()}`, source: effective.saveSource }),
        });
      const payload = await response.json().catch(() => null) as { data?: { id?: string } } | null;
      if (!response.ok || (!effective.saved && !payload?.data?.id)) throw new Error("SAVE_FAILED");
      setSavedOverrides((current) => ({
        ...current,
        [expression.id]: effective.saved ? { saved: false } : { saved: true, savedExpressionId: payload!.data!.id! },
      }));
      setNotice(effective.saved ? "已取消收藏。" : "已收藏表达，不会产生学习证据。");
    } catch {
      setNotice(effective.saved ? "暂时无法取消收藏，请重试。" : "暂时无法收藏表达，请重试。");
    } finally {
      setBusyExpressionId(null);
    }
  }

  function startGeneration(expression: ExploreExpressionLibraryCard, button: HTMLButtonElement) {
    const override = savedOverrides[expression.id];
    const source = expression.generationSource ?? (override?.savedExpressionId
      ? { sourceType: "saved-expression" as const, sourceId: override.savedExpressionId }
      : null);
    if (!source) return;
    generationTrigger.current = button;
    setGeneration({ source, label: expression.text, key: Date.now() });
  }

  function closeGeneration() {
    setGeneration(null);
    window.requestAnimationFrame(() => generationTrigger.current?.focus());
  }

  return (
    <section className="explore-library" aria-labelledby="explore-library-title">
      <div className="section-heading explore-library__heading">
        <div><p className="eyebrow">场景与表达库</p><h2 id="explore-library-title">找到下一次真实沟通</h2></div>
        <span role="status" aria-live="polite">{total} 项匹配</span>
      </div>
      <div className="explore-library__filters" aria-label="场景与表达筛选">
        {filterChoices.map((choice) => (
          <button type="button" key={choice.value} className={filter === choice.value ? "is-selected" : ""} aria-pressed={filter === choice.value} onClick={() => onFilterChange(choice.value)}>
            <strong>{choice.label}</strong><small>{choice.hint}</small>
          </button>
        ))}
      </div>
      {library.privateState === "unavailable" ? <p className="explore-library__private-note" role="status">账号私人资料暂时不可用；公共目录仍可搜索。</p> : null}
      {total === 0 ? (
        <div className="explore-empty explore-library__empty" role="status">
          <strong>没有匹配的场景或表达</strong>
          <span>换一个关键词，或恢复到全部资料继续浏览。</span>
          <button type="button" onClick={onClear}>清除搜索和筛选</button>
        </div>
      ) : (
        <div className="explore-library__groups">
          {results.scenarios.length > 0 ? <section aria-labelledby="explore-library-scenarios-title"><div className="explore-library__group-heading"><h3 id="explore-library-scenarios-title">场景</h3><span>{results.scenarios.length} 个可开始</span></div><div className="explore-scenario-grid">{results.scenarios.map((scenario, index) => <a href={scenario.route} key={scenario.stableKey}><span className="explore-scenario-card__index">{String(index + 1).padStart(2, "0")}</span><div><small>{scenario.cefr} · {scenario.categoryLabel} · {scenario.role}{scenario.sourceKind === "personal" ? " · 私人" : ""}</small><h3>{scenario.title}</h3><p>{scenario.description}</p><span className="explore-scenario-card__goal">{scenario.communicationGoal}</span></div><span aria-hidden="true">→</span></a>)}</div></section> : null}
          {results.expressions.length > 0 ? <section aria-labelledby="explore-library-expressions-title"><div className="explore-library__group-heading"><h3 id="explore-library-expressions-title">表达与来源</h3><span>{results.expressions.length} 条</span></div><div className="explore-expression-grid">{results.expressions.map((expression) => {
            const override = savedOverrides[expression.id];
            const effective = override ? { ...expression, ...override } : expression;
            const canGenerate = Boolean(expression.generationSource || override?.savedExpressionId);
            return <article className="explore-expression-card" key={expression.id}><div className="explore-expression-card__meta"><span>{sourceLabel(expression.sourceKind)}</span><span>{expression.cefr ?? expression.categoryLabel}</span>{expression.region ? <span>{expression.region}</span> : null}</div><h4 lang="es">{expression.text}</h4>{expression.translation ? <p>{expression.translation}</p> : null}{expression.intent ? <small>{expression.intent}</small> : null}<div className="explore-expression-card__actions">{effective.saved || effective.saveSource ? <button type="button" disabled={busyExpressionId === expression.id} aria-label={`${busyExpressionId === expression.id ? "正在保存" : effective.saved ? "取消收藏" : "收藏表达"}：${expression.text}`} aria-pressed={effective.saved} onClick={() => void toggleSaved(expression)}>{busyExpressionId === expression.id ? "正在保存…" : effective.saved ? "取消收藏" : "收藏表达"}</button> : null}{canGenerate ? <button type="button" aria-label={`用此表达生成场景：${expression.text}`} onClick={(event) => startGeneration(expression, event.currentTarget)}>用它生成场景</button> : null}</div></article>;
          })}</div></section> : null}
        </div>
      )}
      {notice ? <p className="explore-library__notice" role="status">{notice}</p> : null}
      {generation ? <PersonalScenarioGenerator key={generation.key} initialSource={generation.source} initialLabel={generation.label} onClose={closeGeneration} /> : null}
    </section>
  );
}
