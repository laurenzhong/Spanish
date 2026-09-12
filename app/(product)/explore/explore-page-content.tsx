"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { ExploreCardDto, ExploreDashboardDto, ExploreGoalDto } from "@/src/modules/explore/domain";
import type { ExploreLibraryDto, ExploreLibraryFilter } from "@/src/modules/explore/domain/explore-library";

import { ExploreLibraryPanel } from "./explore-library-panel";
import { ScenarioSuggestionPanel } from "./scenario-suggestion-panel";

const emptyLibrary: ExploreLibraryDto = { scenarios: [], expressions: [], privateState: "unavailable" };
const legacySavedPacksStorageKey = "explore-saved-packs:v1";
const pendingSavedPacksStorageKey = "explore-pending-saved-packs:v2";
const pendingSavedPacksChangedEvent = "explore-pending-saved-packs-changed";
type ExplorePageContentProps = Readonly<{ dashboard: ExploreDashboardDto; library?: ExploreLibraryDto; initialQuery?: string; initialPack?: string | null; initialSaved?: boolean; initialFilter?: ExploreLibraryFilter }>;

const skillLabels: Record<ExploreCardDto["skills"][number], string> = { listen: "听", read: "读", speak: "说", write: "写" };
const statusLabels: Record<ExploreCardDto["status"], string> = { published: "可开始", in_progress: "继续中", draft: "内容整理中", unavailable: "暂不可用" };

function matches(value: string, query: string): boolean {
  return !query || value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function stateKey(card: ExploreCardDto): string {
  return `${card.stableKey}@${card.version}`;
}

function savedStateFromDashboard(packs: ExploreDashboardDto["packs"]): Record<string, boolean> {
  return Object.fromEntries(packs.flatMap((card) => [
    [stateKey(card), Boolean(card.saved)],
    [card.stableKey, Boolean(card.saved)],
  ]));
}

function readPendingSavedState(raw: string | null, packs: ExploreDashboardDto["packs"]): Record<string, boolean> {
  try {
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    return Object.fromEntries(packs.flatMap((card) => {
      const pending = parsed[stateKey(card)];
      return typeof pending === "boolean"
        ? [[stateKey(card), pending], [card.stableKey, pending]]
        : [];
    }));
  } catch {
    return {};
  }
}

function readPendingSavedStateSnapshot(): string | null {
  try { return window.localStorage.getItem(pendingSavedPacksStorageKey); } catch { return null; }
}

function readEmptyPendingSavedStateSnapshot(): null {
  return null;
}

function subscribeToPendingSavedState(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === pendingSavedPacksStorageKey) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(pendingSavedPacksChangedEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(pendingSavedPacksChangedEvent, onStoreChange);
  };
}

function writePendingSavedState(card: ExploreCardDto, saved: boolean | null): void {
  try {
    const raw = window.localStorage.getItem(pendingSavedPacksStorageKey);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    const key = stateKey(card);
    if (saved === null) delete parsed[key];
    else parsed[key] = saved;

    if (Object.keys(parsed).length === 0) {
      window.localStorage.removeItem(pendingSavedPacksStorageKey);
    } else {
      window.localStorage.setItem(pendingSavedPacksStorageKey, JSON.stringify(parsed));
    }
    window.dispatchEvent(new Event(pendingSavedPacksChangedEvent));
  } catch {
    // The current in-memory state remains usable when browser storage fails.
  }
}

function progressCopy(card: ExploreCardDto): string | null {
  if (card.status === "in_progress" && card.progress) {
    return `已完成 ${card.progress.completedSteps} / ${card.progress.totalSteps} 步`;
  }
  return null;
}

function actionCopy(card: ExploreCardDto): string {
  if (card.status === "draft") return "打开草稿预览";
  return card.status === "in_progress" ? "继续这组内容" : "开始这组内容";
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
}

function CloseIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" /></svg>;
}

function BookmarkIcon({ filled = false }: Readonly<{ filled?: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 4.5h10v15l-5-3.2-5 3.2z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function GoalRow({ goal, index, allowDraftPreview }: Readonly<{ goal: ExploreGoalDto; index: number; allowDraftPreview: boolean }>) {
  const content = <><span className="explore-goal-row__marker">{String(index + 1).padStart(2, "0")}</span><span className="explore-goal-row__body"><strong>{goal.title}</strong><span>{goal.description}</span></span><span className={`explore-goal-row__status${goal.status === "published" ? " explore-goal-row__status--open" : ""}`}>{goal.status === "published" ? `${goal.expressionCount} 句` : "整理中"}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg></>;
  if (goal.status !== "published" && !allowDraftPreview) return <div className="explore-goal-row explore-goal-row--disabled" aria-label={`${goal.title}，内容整理中`}>{content}</div>;
  return <a className="explore-goal-row" href={`/learn?goal=${encodeURIComponent(goal.key)}`} aria-label={`${goal.title}${goal.status === "published" ? "" : "，开始预览"}`}>{content}</a>;
}

function PackCard({ card, selected, saved, onSelect, onToggleSaved, buttonRef }: Readonly<{ card: ExploreCardDto; selected: boolean; saved: boolean; onSelect: (card: ExploreCardDto) => void; onToggleSaved: (card: ExploreCardDto) => void; buttonRef: (node: HTMLButtonElement | null) => void }>) {
  const cardContent = <><div className="explore-pack-card__art" aria-hidden="true"><span>{card.status === "draft" ? "IN EDIT" : "SUEÑO"}</span><strong>{card.title.split(" ")[0]}</strong></div><div className="explore-pack-card__body"><div className="explore-pack-card__meta"><span>{card.level}</span><span>{card.skills.map((skill) => skillLabels[skill]).join(" · ") || "内容包"}</span></div><h3>{card.title}</h3><p>{card.summary}</p><div className="explore-pack-card__footer"><span className={`status-note${card.status === "published" || card.status === "in_progress" ? " status-note--open" : ""}`}>{statusLabels[card.status]}</span><span>{progressCopy(card) ?? card.durationLabel}</span></div></div></>;
  return <article className={`explore-pack-card${selected ? " is-selected" : ""}`} data-status={card.status}><button ref={buttonRef} type="button" className="explore-pack-card__select" aria-label={`查看${card.title}详情，${statusLabels[card.status]}`} onClick={() => onSelect(card)}>{cardContent}</button><button className={`explore-pack-card__save${saved ? " is-saved" : ""}`} type="button" aria-label={saved ? `取消保存${card.title}` : `保存${card.title}`} aria-pressed={saved} onClick={() => onToggleSaved(card)}><BookmarkIcon filled={saved} /></button></article>;
}

function DetailRail({ card, saved, onClose, onToggleSaved }: Readonly<{ card: ExploreCardDto; saved: boolean; onClose: () => void; onToggleSaved: (card: ExploreCardDto) => void }>) {
  const actionLabel = actionCopy(card);
  const progress = progressCopy(card);
  return <aside className="explore-detail-rail" data-testid="explore-detail-rail" aria-label="内容详情"><div className="explore-detail-rail__header"><h2>{card.title}</h2><div className="explore-detail-rail__header-actions"><button className={`icon-button${saved ? " is-saved" : ""}`} type="button" aria-label={saved ? `取消保存${card.title}` : `保存${card.title}`} aria-pressed={saved} onClick={() => onToggleSaved(card)}><BookmarkIcon filled={saved} /></button><button className="icon-button" type="button" aria-label="关闭内容详情" onClick={onClose}><CloseIcon /></button></div></div><p className="explore-detail-rail__summary">{card.summary}</p><dl className="explore-detail-rail__facts"><div><dt>水平</dt><dd>{card.level}</dd></div><div><dt>时长</dt><dd>{card.durationLabel}</dd></div><div><dt>版本</dt><dd>{card.version}</dd></div><div><dt>技能</dt><dd>{card.skills.map((skill) => skillLabels[skill]).join(" · ") || "—"}</dd></div>{card.source ? <div><dt>来源</dt><dd>{card.source.title}</dd></div> : null}</dl><div className="explore-detail-rail__status" role="status"><span className={`status-note${card.status === "published" || card.status === "in_progress" ? " status-note--open" : ""}`}>{statusLabels[card.status]}</span>{progress ? <p>{progress}</p> : null}</div>{card.route ? <a className="primary-action explore-detail-rail__action" href={card.route}><span>{actionLabel}</span><span aria-hidden="true">→</span></a> : <p className="explore-detail-rail__blocked">{card.status === "draft" ? "这组内容完成审核后会出现在这里。" : "这组内容暂时无法读取，请稍后重试。"}</p>}</aside>;
}

export function ExplorePageContent({ dashboard, library = emptyLibrary, initialQuery = "", initialPack = null, initialSaved = false, initialFilter = "all", allowDraftPreview = false }: ExplorePageContentProps & { allowDraftPreview?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedKey, setSelectedKey] = useState<string | null>(initialPack);
  const [railOpen, setRailOpen] = useState(Boolean(initialPack));
  const [packFilter, setPackFilter] = useState<"all" | "saved" | "available" | "draft">(initialSaved ? "saved" : "all");
  const [libraryFilter, setLibraryFilter] = useState<ExploreLibraryFilter>(initialFilter);
  const [savedOverrides, setSavedOverrides] = useState<Record<string, boolean>>({});
  const pendingSavedStateRaw = useSyncExternalStore(
    subscribeToPendingSavedState,
    readPendingSavedStateSnapshot,
    readEmptyPendingSavedStateSnapshot,
  );
  const savedByKey = useMemo(() => ({
    ...savedStateFromDashboard(dashboard.packs),
    ...readPendingSavedState(pendingSavedStateRaw, dashboard.packs),
    ...savedOverrides,
  }), [dashboard.packs, pendingSavedStateRaw, savedOverrides]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const saveRequestId = useRef(0);

  const filteredGoals = useMemo(() => dashboard.goals.filter((goal) => matches(`${goal.title} ${goal.description} ${goal.key}`, query.trim())), [dashboard.goals, query]);
  const filteredPacks = useMemo(() => dashboard.packs.filter((card) => {
    const textMatches = matches(`${card.title} ${card.summary} ${card.level} ${card.skills.join(" ")} ${card.status}`, query.trim());
    const filterMatches = packFilter === "all" || (packFilter === "saved" ? Boolean(savedByKey[stateKey(card)]) : packFilter === "available" ? card.status === "published" || card.status === "in_progress" : card.status === "draft");
    return textMatches && filterMatches;
  }), [dashboard.packs, packFilter, query, savedByKey]);
  const selectedCard = dashboard.packs.find((card) => card.stableKey === selectedKey) ?? null;

  function updateUrl(nextQuery: string, nextKey: string | null, nextLibraryFilter = libraryFilter, nextPackFilter = packFilter) {
    const params = new URLSearchParams(window.location.search);
    if (nextQuery) params.set("q", nextQuery); else params.delete("q");
    if (nextKey) params.set("pack", nextKey); else params.delete("pack");
    if (nextLibraryFilter === "all") params.delete("filter"); else params.set("filter", nextLibraryFilter);
    if (nextPackFilter === "saved") params.set("saved", "1"); else params.delete("saved");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  useEffect(() => {
    updateUrl(query, selectedKey, libraryFilter, packFilter);
    // updateUrl is an intentionally local URL adapter; state values trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryFilter, packFilter, query, selectedKey]);
  useEffect(() => {
    try { window.localStorage.removeItem(legacySavedPacksStorageKey); } catch { /* Ignore unavailable browser storage. */ }
  }, []);
  function selectCard(card: ExploreCardDto) { setSelectedKey(card.stableKey); setRailOpen(true); updateUrl(query, card.stableKey); }
  function closeRail() {
    const previousKey = selectedKey;
    setRailOpen(false);
    setSelectedKey(null);
    updateUrl(query, null);
    if (previousKey) window.requestAnimationFrame(() => triggerRefs.current[previousKey]?.focus());
  }
  function toggleSaved(card: ExploreCardDto) {
    const requestId = ++saveRequestId.current;
    const key = stateKey(card);
    const nextSaved = !Boolean(savedByKey[key]);
    setSavedOverrides((current) => ({ ...current, [key]: nextSaved, [card.stableKey]: nextSaved }));
    setSaveNotice(nextSaved ? "已保存到你的探索清单。" : "已从探索清单移除。");
    void fetch("/api/v1/explore/state", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ stableKey: card.stableKey, version: Number(card.version.slice(1)) || 1, totalSteps: card.progress?.totalSteps ?? 1, completedSteps: card.progress?.completedSteps ?? 0, saved: nextSaved }) })
      .then((response) => {
        if (!response.ok) throw new Error("EXPLORE_STATE_SYNC_FAILED");
        if (requestId === saveRequestId.current) {
          writePendingSavedState(card, null);
          setSaveNotice(nextSaved ? "已保存到你的探索清单，已同步到账号。" : "已从探索清单移除，已同步到账号。");
        }
      })
      .catch(() => {
        if (requestId === saveRequestId.current) {
          writePendingSavedState(card, nextSaved);
          setSaveNotice(nextSaved ? "已保存在本设备，账号同步失败，可重试。" : "已从本设备移除，账号同步失败。");
        }
      });
  }

  return (
    <div className="page-stack explore-page">
      <header className="explore-page__header">
        <h1>探索真实表达</h1>
        <a href="/explore/history">练习历史</a>
      </header>

      <section className="explore-intent" aria-label="按意图查找">
        <label className="explore-intent__field">
          <span className="sr-only">搜索沟通目标和内容</span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              updateUrl(event.target.value, selectedKey);
            }}
            placeholder="搜索想练的表达，例如：请求别人重复"
          />
          {query ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                setQuery("");
                updateUrl("", selectedKey);
              }}
            >
              <CloseIcon />
            </button>
          ) : (
            <span aria-hidden="true"><SearchIcon /></span>
          )}
        </label>
      </section>

      <ScenarioSuggestionPanel
        onTopicSelected={(topic) => {
          setQuery(topic);
          updateUrl(topic, selectedKey);
        }}
      />

      <ExploreLibraryPanel library={library} query={query} filter={libraryFilter} onFilterChange={(nextFilter) => { setLibraryFilter(nextFilter); updateUrl(query, selectedKey, nextFilter); }} onClear={() => { setQuery(""); setLibraryFilter("all"); updateUrl("", selectedKey, "all"); }} />

      {saveNotice ? <p className="explore-save-notice" role="status">{saveNotice}</p> : null}

      {dashboard.resume.length > 0 ? (
        <section className="explore-resume" aria-labelledby="explore-resume-title">
          <h2 id="explore-resume-title">继续探索</h2>
          <div className="explore-resume__items">
            {dashboard.resume.map((card) => (
              <button type="button" className="explore-resume__item" key={card.id} onClick={() => selectCard(card)}>
                <span>{card.title}</span>
                <strong>{progressCopy(card) ?? card.durationLabel}</strong>
                <span aria-hidden="true">→</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className={`explore-workspace${railOpen && selectedCard ? " explore-workspace--with-rail" : ""}`}>
        <main className="explore-main">
          <section className="explore-goals" aria-labelledby="explore-goals-title">
            <div className="section-heading">
              <h2 id="explore-goals-title">沟通目标</h2>
            </div>
            {filteredGoals.length > 0 ? (
              <div className="explore-goal-index" aria-label="沟通目标">
                {filteredGoals.map((goal, index) => (
                  <GoalRow allowDraftPreview={allowDraftPreview} goal={goal} index={index} key={goal.key} />
                ))}
              </div>
            ) : (
              <div className="explore-empty" role="status">
                <strong>没有匹配的目标</strong>
                <span>换一种说法，或先浏览全部沟通动作。</span>
              </div>
            )}
          </section>

          <section className="explore-packs" aria-labelledby="content-packs-title">
            <div className="section-heading">
              <h2 id="content-packs-title">内容包</h2>
            </div>
            <div className="explore-filter-chips" aria-label="内容筛选">
              {([["all", "全部"], ["saved", "已保存"], ["available", "可开始"], ["draft", "整理中"]] as const).map(([value, label]) => (
                <button
                  className={packFilter === value ? "is-selected" : ""}
                  type="button"
                  aria-label={`${label}内容包`}
                  aria-pressed={packFilter === value}
                  key={value}
                  onClick={() => {
                    setPackFilter(value);
                    updateUrl(query, selectedKey, libraryFilter, value);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredPacks.length > 0 ? (
              <div className="explore-pack-grid">
                {filteredPacks.map((card) => (
                  <PackCard
                    buttonRef={(node) => { triggerRefs.current[card.stableKey] = node; }}
                    card={card}
                    saved={Boolean(savedByKey[card.stableKey])}
                    selected={selectedKey === card.stableKey}
                    onSelect={selectCard}
                    onToggleSaved={toggleSaved}
                    key={card.id}
                  />
                ))}
              </div>
            ) : (
              <div className="explore-empty" role="status">
                <strong>暂时没有匹配的内容包</strong>
                <span>清除筛选或搜索后查看其他内容。</span>
              </div>
            )}
          </section>
        </main>
        {railOpen && selectedCard ? (
          <DetailRail
            card={selectedCard}
            saved={Boolean(savedByKey[selectedCard.stableKey])}
            onClose={closeRail}
            onToggleSaved={toggleSaved}
          />
        ) : null}
      </div>
    </div>
  );
}
