"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useBrowserSpeech } from "@/src/modules/providers/tts";

import {
  activeRankMilestone,
  rankBandAnchor,
  rankMilestoneLabel,
  reachableRankMilestones,
  vocabularyRankBandSize,
  type VocabularyRankBand,
} from "./vocabulary-rank";

export type { VocabularyShelfItem } from "./vocabulary-shelf-list";

/**
 * The reviewed glossary entry of a word, as the page passes it in.
 *
 * `meanings` keeps the reviewed file's own order. The glossary has no frequency
 * field, so there is nothing to sort "most common first" by — the first meaning
 * is the one the word tile already shows underneath, and the rest follow the
 * entry's own sequence. Nothing here invents a ranking.
 */
export type VocabularyShelfGlossary = Readonly<{
  cefr: string;
  partOfSpeech: string;
  meanings: readonly Readonly<{ meaning: string; usage: string }>[];
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
}>;

export type VocabularyShelfStatus = "familiar" | "revisit" | "ignore";

type VocabularyShelfProps = Readonly<{
  /** The server-rendered shelf: every band, heading and word tile. */
  children: React.ReactNode;
  storageScope: string;
  /** Reviewed meanings per mark key, for the hover/focus translation and the card. */
  glossary: Readonly<Record<string, VocabularyShelfGlossary>>;
  bands: readonly VocabularyRankBand[];
  total: number;
  /** False for a search result, whose positions are not shelf ranks. */
  ranked: boolean;
}>;

type Hovered = Readonly<{
  word: string;
  meanings: VocabularyShelfGlossary["meanings"];
  /** The word's own list row: the layer is rendered inside it and CSS anchors it. */
  container: HTMLElement;
}>;

type Selected = Readonly<{ key: string; word: string; example: string | null; source: string | null }>;

/**
 * One wording for the familiar/revisit/ignore triad. The server-backed shelves
 * own the same words (`lexicon-shelf-controls.tsx`, `vocabulary-library.tsx`,
 * `phrase-library.tsx`) so one state never reads two ways.
 */
const statusOptions = [
  ["familiar", "已熟悉"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const satisfies readonly (readonly [VocabularyShelfStatus, string])[];

const statusLabels: Record<VocabularyShelfStatus, string> = { familiar: "已熟悉", revisit: "想复现", ignore: "暂不学习" };

/**
 * Browser-local marks, deliberately the same storage contract the study shelf
 * used (`sueno:vocabulary-status:v1:<scope>`, a flat `{ headword: status }`
 * map, the same cross-tab event), so a reader's existing marks stay valid.
 *
 * The server-side `user_lexical_intents` mechanism cannot serve this shelf: it
 * keys on a lexeme or phrase row, and the corpus still contains zero lexemes
 * because the indexing pipeline has never run.
 */
const storagePrefix = "sueno:vocabulary-status:v1:";
const statusEvent = "sueno:vocabulary-status-changed";
const emptyStatuses: Record<string, VocabularyShelfStatus> = {};
const statusSnapshots = new Map<string, Record<string, VocabularyShelfStatus>>();

const translationId = "vocabulary-translation";

function statusStorageKey(scope: string): string {
  return `${storagePrefix}${scope}`;
}

function parseStatuses(scope: string): Record<string, VocabularyShelfStatus> {
  const next: Record<string, VocabularyShelfStatus> = {};
  try {
    const raw = window.localStorage.getItem(statusStorageKey(scope));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (value === "familiar" || value === "revisit" || value === "ignore") next[key] = value;
      }
    }
  } catch {
    return {};
  }
  return next;
}

/** `useSyncExternalStore` needs one cached object per scope, not a fresh map. */
function readStatuses(scope: string): Record<string, VocabularyShelfStatus> {
  const cached = statusSnapshots.get(scope);
  if (cached) return cached;
  const next = parseStatuses(scope);
  statusSnapshots.set(scope, next);
  return next;
}

function subscribeStatuses(callback: () => void): () => void {
  const onChange = () => {
    statusSnapshots.clear();
    callback();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener(statusEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(statusEvent, onChange);
  };
}

function writeStatuses(scope: string, next: Record<string, VocabularyShelfStatus>): void {
  statusSnapshots.set(scope, next);
  try {
    window.localStorage.setItem(statusStorageKey(scope), JSON.stringify(next));
  } catch {
    // Ignore storage failures; the current session keeps its marks.
  }
  window.dispatchEvent(new Event(statusEvent));
}

/** The word tile an event happened on, or null when it happened elsewhere. */
function tileFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>("[data-word-key]");
}

/**
 * The interactive frame around the server-rendered shelf.
 *
 * The 7,922 tiles stay plain HTML: this frame listens on their container and
 * reads each tile's `data-*` attributes, so a page holding the whole shelf never
 * pays for a hydrated component per word. Marks and selection are applied to the
 * few marked tiles imperatively instead of re-rendering all of them.
 *
 * The hover translation is mirrored on real keyboard focus (not `title`, which
 * keyboard and touch users cannot reach and which cannot be styled), and the
 * floating layer is `pointer-events: none` so it can never swallow a click
 * meant for a neighbouring word. Touch has no hover at all, so the click-open
 * card remains the equivalent path: it carries the same meanings plus the
 * word's published example.
 */
export function VocabularyShelf({ children, storageScope, glossary, bands, total, ranked }: VocabularyShelfProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const decoratedRef = useRef<ReadonlySet<string>>(new Set());
  const describedRef = useRef<HTMLElement | null>(null);
  const hoveredTileRef = useRef<HTMLElement | null>(null);
  const selectedTileRef = useRef<HTMLElement | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [notice, setNotice] = useState("");
  const [activeMilestone, setActiveMilestone] = useState(1);
  const statuses = useSyncExternalStore(subscribeStatuses, () => readStatuses(storageScope), () => emptyStatuses);
  const speech = useBrowserSpeech();
  const speakingId = speech.speakingId;

  const hideTranslation = useCallback(() => {
    describedRef.current?.removeAttribute("aria-describedby");
    describedRef.current = null;
    hoveredTileRef.current = null;
    setHovered(null);
  }, []);

  const showTranslation = useCallback((tile: HTMLElement) => {
    const entry = glossary[tile.dataset.wordKey ?? ""];
    if (!entry?.meanings.length) {
      // Nothing reviewed to show: the tile's own placeholder already answers,
      // and inventing a translation here is exactly what must not happen.
      describedRef.current?.removeAttribute("aria-describedby");
      describedRef.current = null;
      hoveredTileRef.current = null;
      setHovered(null);
      return;
    }
    if (describedRef.current !== tile) {
      describedRef.current?.removeAttribute("aria-describedby");
      // Screen readers get the same meanings the sighted hover shows.
      tile.setAttribute("aria-describedby", translationId);
      describedRef.current = tile;
    }
    const container = tile.parentElement;
    if (!container) {
      hoveredTileRef.current = null;
      setHovered(null);
      return;
    }
    hoveredTileRef.current = tile;
    // No coordinates: the layer is rendered into the word's own row and CSS
    // anchors it there, so scrolling never needs a geometry read.
    setHovered({ word: tile.dataset.word ?? "", meanings: entry.meanings, container });
  }, [glossary]);

  const selectTile = useCallback((tile: HTMLElement) => {
    const key = tile.dataset.wordKey ?? "";
    hideTranslation();
    // Accent-folded keys repeat on the shelf (`solo`/`sólo` share one mark key),
    // so the *clicked tile* decides what is selected, not the key.
    const closing = selectedTileRef.current === tile;
    selectedTileRef.current = closing ? null : tile;
    setSelected(closing ? null : {
      key,
      word: tile.dataset.word ?? "",
      example: tile.dataset.example ?? null,
      source: tile.dataset.source ?? null,
    });
  }, [hideTranslation]);

  const markStatus = useCallback((markKey: string, status: VocabularyShelfStatus) => {
    const next = { ...readStatuses(storageScope) };
    if (next[markKey] === status) delete next[markKey];
    else next[markKey] = status;
    writeStatuses(storageScope, next);
  }, [storageScope]);

  const toggleSpeech = useCallback((key: string, word: string) => {
    if (speech.speakingId === key) {
      speech.stop();
      return;
    }
    setNotice("");
    speech.speak(key, word, () => setNotice("当前浏览器不支持朗读，单词仍可正常学习。"));
  }, [speech]);

  // Marks and selection live on server-rendered tiles, so they are applied to
  // the few marked nodes rather than by re-rendering all 7,922 of them. A mark
  // key can match more than one tile (`solo`/`sólo`), and both must show it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = new Set<string>(Object.keys(statuses));
    if (selected) next.add(selected.key);
    const decorateKey = (key: string, on: boolean) => {
      const status = statuses[key];
      for (const tile of container.querySelectorAll<HTMLElement>(`[data-word-key="${CSS.escape(key)}"]`)) {
        tile.classList.toggle("is-familiar", on && status === "familiar");
        tile.classList.toggle("is-revisit", on && status === "revisit");
        tile.classList.toggle("is-ignore", on && status === "ignore");
      }
    };
    for (const key of decoratedRef.current) if (!next.has(key)) decorateKey(key, false);
    for (const key of next) decorateKey(key, true);

    for (const tile of container.querySelectorAll<HTMLElement>(".vocabulary-study__word.is-selected")) {
      if (tile !== selectedTileRef.current) tile.classList.remove("is-selected");
    }
    selectedTileRef.current?.classList.add("is-selected");
    decoratedRef.current = next;
  }, [statuses, selected]);

  // The rail marks the band the reader is in: with no pages left to be "on",
  // the milestone is the last one the band at the top of the viewport passed.
  useEffect(() => {
    if (!ranked || !bands.length) return;
    const container = containerRef.current;
    if (!container) return;
    const bandNodes = [...container.querySelectorAll<HTMLElement>("[data-band-start]")];
    if (!bandNodes.length) return;
    // One observation line 140px below the top edge: whichever band crosses it is
    // the one the reader is in. No scroll listener, and no layout read at all.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const start = Number((entry.target as HTMLElement).dataset.bandStart ?? "1");
        setActiveMilestone(activeRankMilestone(start, total));
      }
    }, { rootMargin: "-140px 0px -100% 0px", threshold: 0 });
    for (const node of bandNodes) observer.observe(node);
    return () => observer.disconnect();
  }, [ranked, bands, total]);

  useEffect(() => () => { describedRef.current?.removeAttribute("aria-describedby"); }, []);

  const marked = Object.keys(statuses).length;
  const visibleNotice = speech.errorMessage || notice;
  const entry = selected ? glossary[selected.key] ?? null : null;
  const milestones = ranked && total > vocabularyRankBandSize ? reachableRankMilestones(total) : [];

  return <section className="vocabulary-study" aria-label="词汇表">
    <p className="vocabulary-study__summary" aria-live="polite">已标记 {marked} 个 · 标记保存在本机浏览器，换设备不会同步</p>
    {visibleNotice ? <p className="vocabulary-study__notice" role="status">{visibleNotice}</p> : null}

    <div className="vocabulary-shelf__body">
      <div
        className="vocabulary-shelf__bands"
        ref={containerRef}
        onMouseOver={(event) => { const tile = tileFrom(event.target); if (tile) showTranslation(tile); }}
        onMouseOut={(event) => {
          const tile = tileFrom(event.target);
          if (tile && !tile.contains(event.relatedTarget as Node | null)) hideTranslation();
        }}
        onFocus={(event) => { const tile = tileFrom(event.target); if (tile) showTranslation(tile); }}
        onBlur={(event) => { if (tileFrom(event.target)) hideTranslation(); }}
        onClick={(event) => { const tile = tileFrom(event.target); if (tile) selectTile(tile); }}
        onKeyDown={(event) => { if (event.key === "Escape") { hideTranslation(); selectedTileRef.current = null; setSelected(null); } }}
      >
        {children}
      </div>

      {milestones.length ? <nav className="vocabulary-rank-rail" aria-label="按名次跳转">
        <p className="vocabulary-rank-rail__caption">名次（已滤除功能词）</p>
        {milestones.map((rank) => <a
          key={rank}
          href={`#${rankBandAnchor(rank, total)}`}
          aria-current={rank === activeMilestone ? "true" : undefined}
          aria-label={`跳到第 ${rankMilestoneLabel(rank)} 名`}
        >{rankMilestoneLabel(rank)}</a>)}
      </nav> : null}
    </div>

    {/* Rendered into the hovered word's own list row and anchored by CSS: it
        follows the word with no geometry read, and no scroll listener exists to
        keep it in place. Portalled because the page wrapper carries a
        `transform` (its entrance animation), which would otherwise become the
        containing block for anything positioned. */}
    {hovered ? createPortal(<div className="vocabulary-shelf__translation" id={translationId} role="tooltip">
      <p className="vocabulary-shelf__translation-word" lang="es">{hovered.word}</p>
      <ul className="vocabulary-shelf__translation-meanings">
        {hovered.meanings.map((meaning) => <li key={meaning.meaning}>
          <strong>{meaning.meaning}</strong>
          {meaning.usage ? <span>{meaning.usage}</span> : null}
        </li>)}
      </ul>
    </div>, hovered.container) : null}

    {selected ? <aside className="vocabulary-study__card" aria-live="polite" aria-label={`${selected.word} 词汇卡片`}>
      <div className="vocabulary-study__card-head">
        <div>
          <p className="vocabulary-study__eyebrow">
            {entry ? `已审核词表 · ${entry.cefr} · ${entry.partOfSpeech}` : "参考词表"}
          </p>
          <h3 lang="es">{selected.word}</h3>
        </div>
        <div className="vocabulary-study__card-actions">
          <button type="button" onClick={() => toggleSpeech(selected.key, selected.word)}>{speakingId === selected.key ? "停止朗读" : "朗读单词"}</button>
          <button type="button" onClick={() => { selectedTileRef.current = null; setSelected(null); }}>关闭</button>
        </div>
      </div>

      {entry
        ? <ul className="vocabulary-study__meanings">
          {entry.meanings.map((meaning) => <li key={meaning.meaning}><strong>{meaning.meaning}</strong>{meaning.usage ? <span>{meaning.usage}</span> : null}</li>)}
        </ul>
        : <p className="vocabulary-study__muted">这个词还没有审核过的中文释义，先按下面的语境理解它。</p>}

      {entry?.collocations.length ? <div className="vocabulary-study__block"><h4>常用搭配</h4><p className="vocabulary-study__chips" lang="es">{entry.collocations.map((item) => <span key={item}>{item}</span>)}</p></div> : null}
      {entry?.examples.length ? <div className="vocabulary-study__block"><h4>词表例句</h4><ul className="vocabulary-study__examples" lang="es">{entry.examples.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      {entry?.forms.length ? <div className="vocabulary-study__block"><h4>常见变位 / 形式</h4><p className="vocabulary-study__chips" lang="es">{entry.forms.slice(0, 8).map((item) => <span key={item}>{item}</span>)}</p></div> : null}

      <div className="vocabulary-study__block">
        <h4>已发布内容中的真实例句</h4>
        {selected.example
          ? <figure className="vocabulary-study__corpus">
            <blockquote lang="es">{selected.example}</blockquote>
            {selected.source ? <figcaption>{selected.source}</figcaption> : null}
          </figure>
          : <p className="vocabulary-study__muted">已发布内容中暂时没有收录这个词的例句。</p>}
      </div>

      <div className="vocabulary-study__marking" role="group" aria-label={`标记 ${selected.word}`}>
        {statusOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={statuses[selected.key] === value} className={statuses[selected.key] === value ? "is-active" : undefined} onClick={() => markStatus(selected.key, value)}>{label}</button>)}
        {statuses[selected.key] ? <button type="button" onClick={() => markStatus(selected.key, statuses[selected.key]!)}>清除标记</button> : null}
        <span className="vocabulary-study__muted">{statuses[selected.key] ? `当前：${statusLabels[statuses[selected.key]!]}` : "还没有标记"}</span>
      </div>
    </aside> : null}
  </section>;
}
