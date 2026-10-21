"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useReadAloud } from "@/src/modules/providers/tts";
import type { TatoebaExample } from "@/src/modules/lexicon-corpus/application/tatoeba-examples";
import { TatoebaExampleRow } from "./tatoeba-example-row";
import { useMediaQuery } from "@/src/shared/ui/use-media-query";

// Medium desktops use an overlay too, so the word grid keeps its full width.
const wordPanelOverlayQuery = "(max-width: 1199px)";

import { displayMeanings, type DisplayMeanings, type MeaningSource } from "./vocabulary-meanings";
import { VocabularyRecall } from "./vocabulary-recall";
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
 * The *reviewed* glossary entry of a word, as the page passes it in. Only words
 * the reviewed file carries are in this map — the dictionary translations travel
 * separately, as bare lists (see `dictionary` below), because shipping the rich
 * shape per word measured six times the bytes.
 *
 * `meanings` keeps the reviewed file's own order, which is not a frequency order:
 * it is used as given, and its first meaning is the one the tile shows
 * underneath. Which of the two sources a word displays is decided by
 * `displayMeanings`, never here.
 */
export type VocabularyShelfGlossary = Readonly<{
  cefr: string;
  partOfSpeech: string;
  meanings: readonly Readonly<{ meaning: string; usage: string }>[];
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
  /**
   * Tatoeba's examples for this word. Third-party content under CC BY 2.0 FR, so it
   * travels with its own attribution and the panel renders the credit with it — it is
   * never shown as if it were ours, and never without its author and licence.
   */
  tatoeba: readonly TatoebaExample[];
}>;

/**
 * The Tatoeba credit lines, from the asset's own record.
 *
 * Kept as functions because the panel and its tests must agree on the same URL, and a
 * second hand-written copy would be the one that drifts.
 */
export function tatoebaSentenceUrl(sentenceId: number): string {
  return `https://tatoeba.org/en/sentences/show/${sentenceId}`;
}

export function tatoebaUserUrl(owner: string): string {
  return `https://tatoeba.org/en/users/show/${encodeURIComponent(owner)}`;
}

export type VocabularyShelfStatus = "familiar" | "learning" | "revisit" | "ignore";

type VocabularyShelfProps = Readonly<{
  /** Server-rendered search and count, sharing a toolbar with the local controls. */
  controls?: React.ReactNode;
  /** The server-rendered shelf: every band, heading and word tile. */
  children: React.ReactNode;
  storageScope: string;
  /** The reviewed glossary, for the words the reviewed file carries. */
  glossary: Readonly<Record<string, VocabularyShelfGlossary>>;
  /**
   * Language Reactor's translations, by mark key, as bare lists — the slim shape
   * keeps the meanings payload off the page's critical path. The browser holds
   * only this page's words, and only the words the asset has.
   */
  dictionary: Readonly<Record<string, readonly string[]>>;
  bands: readonly VocabularyRankBand[];
  total: number;
  /** False for a search result, whose positions are not shelf ranks. */
  ranked: boolean;
}>;

type Hovered = Readonly<{
  /** The mark key of the hovered word, so the layer can mark it directly. */
  key: string;
  word: string;
  meanings: VocabularyShelfGlossary["meanings"];
  /** The word's own list row: the layer is rendered inside it and CSS anchors it. */
  container: HTMLElement;
}>;

/**
 * The word the panel is showing.
 *
 * Built from a tile (`selectTile`) or from the lookup form (`applyEntry`). It
 * carries everything the panel renders, so the panel never has to ask which path
 * opened it — the two paths fill the same fields, which is what keeps a looked-up
 * word from rendering differently than a clicked one.
 */
type Selected = Readonly<{
  key: string;
  word: string;
  example: string | null;
  source: string | null;
  meanings: DisplayMeanings | null;
  usageNotes: readonly string[];
  cefr: string | null;
  partOfSpeech: string | null;
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
  /** Tatoeba's examples with their credit; empty when the word has none. */
  tatoeba: readonly TatoebaExample[];
}>;

/** What `POST /api/v1/read/word-lookup` answers. */
type WordLookupResponse = Readonly<{
  found: boolean;
  word: string;
  markKey?: string;
  meanings?: readonly { meaning: string; usage: string }[];
  meaningSource?: MeaningSource;
  usageNotes?: readonly string[];
  cefr?: string | null;
  partOfSpeech?: string | null;
  collocations?: readonly string[];
  examples?: readonly string[];
  forms?: readonly string[];
  context?: string | null;
  sourceTitle?: string | null;
  tatoeba?: readonly TatoebaExample[];
}>;

/**
 * The wording the server-backed shelves use for three of these states
 * (`lexicon-shelf-controls.tsx`, `vocabulary-library.tsx`, `phrase-library.tsx`)
 * so one state never reads two ways. `learning` is local to this shelf: the
 * server's `user_lexical_intents` triad has no equivalent, and mapping "正在学习"
 * onto 想复现 ("want to see it again") would make the button's label say
 * something the stored state does not mean.
 */
const statusOptions = [
  ["familiar", "已熟悉"],
  ["learning", "正在学习"],
  ["revisit", "想复现"],
  ["ignore", "暂不学习"],
] as const satisfies readonly (readonly [VocabularyShelfStatus, string])[];

const statusLabels: Record<VocabularyShelfStatus, string> = { familiar: "已熟悉", learning: "正在学习", revisit: "想复现", ignore: "暂不学习" };

/**
 * Browser-local marks, deliberately the same storage contract the study shelf
 * used (`sueno:vocabulary-status:v1:<scope>`, a flat `{ headword: status }`
 * map, the same cross-tab event), so a reader's existing marks stay valid.
 * `learning` is an extra value in that same map: existing keys and values are
 * untouched, and a build that predates it ignores the new value rather than
 * losing the map.
 *
 * The server-side `user_lexical_intents` mechanism cannot serve this shelf: it
 * keys on a lexeme or phrase row, and the corpus still contains zero lexemes
 * because the indexing pipeline has never run.
 */
const storagePrefix = "sueno:vocabulary-status:v1:";
const statusEvent = "sueno:vocabulary-status-changed";
const emptyStatuses: Record<string, VocabularyShelfStatus> = {};
const statusSnapshots = new Map<string, Record<string, VocabularyShelfStatus>>();

/**
 * Whether opening a word also says it. On by default, as Language Reactor has it,
 * because that is what makes a click feel like "show me this word" — but it is a
 * preference and not a fixed behaviour: a reader working through a long list, or in
 * a quiet room, must be able to turn the sound off without losing the read button.
 *
 * Stored per storage scope alongside the marks, in the reader's own browser: the
 * server holds no preference for this shelf, and the setting is not user data.
 */
const autoplayStoragePrefix = "sueno:vocabulary-autoplay:v1:";
const autoplayEvent = "sueno:vocabulary-autoplay-changed";

const translationId = "vocabulary-translation";
const translationLayerId = "vocabulary-translation-layer";

/** The two shortcuts the layer offers, on top of the card's full set. */
const quickStatusOptions = [
  ["familiar", "标为已知"],
  ["learning", "标为正在学习"],
] as const satisfies readonly (readonly [VocabularyShelfStatus, string])[];

/** Which card asked for the sound: the hover layer, or the word's own card. */
type ReadOrigin = "layer" | "card";

/** One active word or example; loading lasts until the engine confirms start. */
type ReadAloud =
  | Readonly<{ phase: "tatoeba"; origin: ReadOrigin; key: string; sentenceId: number; playback: "loading" | "playing" }>
  | Readonly<{ phase: "tatoeba-synthetic"; origin: ReadOrigin; key: string; sentenceId: number; playback: "loading" | "playing" }>
  | Readonly<{ phase: "loading"; origin: ReadOrigin; key: string }>
  | Readonly<{ phase: "synthetic"; origin: ReadOrigin; key: string }>;

/**
 * The word panel's content, as a component rather than a variable.
 *
 * It is rendered by two parents: the work area's second column on a desktop, and a
 * bottom sheet portalled to `body` on a phone. A component keeps that one source
 * of truth — the same markup, meanings, examples and marks in both — while letting
 * each parent sit where its layout needs it. A `ReactNode` variable could only be
 * mounted once, and a portal plus an inline copy would be two entries to keep in
 * step.
 */
function WordPanelContent(props: Readonly<{
  word: string;
  meanings: ReturnType<typeof displayMeanings> | null;
  usageNotes: readonly string[];
  entry: VocabularyShelfGlossary | null;
  example: string | null;
  source: string | null;
  /** Tatoeba's examples for this word, each with the credit the licence requires. */
  tatoeba: readonly TatoebaExample[];
  exampleRead: Readonly<{ sentenceId: number; playback: "loading" | "playing" }> | null;
  exampleNotice: Readonly<{ sentenceId: number; text: string }> | null;
  onToggleExample: (example: TatoebaExample) => void;
  statuses: Readonly<Record<string, VocabularyShelfStatus>>;
  readPhase: "loading" | "synthetic" | null;
  readNotice: string;
  /** The lookup form's state, owned by the frame so the panel stays presentational. */
  lookup: Readonly<{
    value: string;
    state: "idle" | "loading" | "missing" | "error";
    notice: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  }>;
  onToggleRead: () => void;
  onMark: (status: VocabularyShelfStatus) => void;
  onClearMark: (status: VocabularyShelfStatus) => void;
  onClose: () => void;
}>): React.ReactElement {
  const { meanings, entry, statuses, word } = props;
  return <>
    <div className="vocabulary-study__card-head">
      <div>
        <h3 lang="es">{word}</h3>
      </div>
      <div className="vocabulary-study__card-actions">
        <button
          type="button"
          aria-busy={props.readPhase === "loading" || undefined}
          aria-pressed={Boolean(props.readPhase)}
          onClick={props.onToggleRead}
        >{props.readPhase ? "停止朗读" : "朗读单词"}</button>
        <button type="button" onClick={props.onClose}>关闭</button>
      </div>
    </div>

    {/* Word pronunciation carries no status line: the owner asked for no
        "synthesis"/"preparing" wording (2026-10-20). The button's stop label,
        aria-busy and aria-pressed carry loading and playback; only failures keep a
        visible, retryable notice. */}
    {props.readNotice ? <p className="vocabulary-study__notice" role="status">{props.readNotice}</p> : null}
    {meanings?.meanings.length
      ? <ul className="vocabulary-study__meanings">
        {/* One main meaning, then the rest on a single wrapping line.
            The panel is a 350-440px column, and the previous shape gave every
            meaning its own padded block with its usage note underneath — three
            lines for two meanings, most of the panel's height spent on the part a
            reader consults last. The main meaning keeps its room; the others stay
            readable as a list of terms, with their usage notes still present for
            assistive technology and for a reader who expands nothing. */}
        <li className="vocabulary-study__meaning-main">
          <strong>{meanings.meanings[0]!.meaning}</strong>
          {meanings.meanings[0]!.usage ? <span>{meanings.meanings[0]!.usage}</span> : null}
        </li>
        {meanings.meanings.length > 1
          ? <li className="vocabulary-study__meaning-rest">
            {/* One list item per term, displayed inline by the stylesheet. A row
                of inline items wraps like a sentence, and the separator is drawn
                between them by CSS, so no separator can ever land alone on a line
                (which is what a flex row of terms did in the rendered panel). */}
            <ul className="vocabulary-study__meaning-terms">
              {meanings.meanings.slice(1).map((meaning) => <li key={meaning.meaning}>{meaning.meaning}</li>)}
            </ul>
          </li>
          : null}
      </ul>
      : <p className="vocabulary-study__muted">这个词还没有可显示的中文释义，先按下面的语境理解它。</p>}

    <div className="vocabulary-study__marking" role="group" aria-label={`标记 ${word}`}>
      {statusOptions.map(([value, label]) => <button key={value} type="button" aria-pressed={statuses[word] === value} className={statuses[word] === value ? "is-active" : undefined} onClick={() => props.onMark(value)}>{label}</button>)}
      {statuses[word] ? <button type="button" onClick={() => props.onClearMark(statuses[word]!)}>清除标记</button> : null}
      <span className="vocabulary-study__muted">{statuses[word] ? `当前：${statusLabels[statuses[word]!]}` : "还没有标记"}</span>
    </div>

    {entry?.examples.length || props.tatoeba.length ? <section className="vocabulary-study__block vocabulary-study__example-section">
      <h4>例句</h4>
    {entry?.examples.length ? <div className="vocabulary-study__block"><h4>词表例句</h4><ul className="vocabulary-study__examples" lang="es">{entry.examples.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {props.tatoeba.length
      ? <div className="vocabulary-study__block">
        <h4>例句 · Tatoeba</h4>
        <ul className="vocabulary-study__tatoeba">
          {props.tatoeba.map((example) => <li key={example.sentenceId || example.text}>
            <TatoebaExampleRow example={example}
              phase={props.exampleRead?.sentenceId === example.sentenceId ? props.exampleRead.playback : null}
              notice={props.exampleNotice?.sentenceId === example.sentenceId ? props.exampleNotice.text : ""}
              onToggle={() => props.onToggleExample(example)} />
            {/* CC BY 2.0 FR requires naming the author and the licence for *both* the
                sentence and its translation, and a link back to the sentence is how a
                reader can check or trace it. Nothing here is presented as ours. */}
            <p className="vocabulary-study__tatoeba-credit">
              {/* Why this sentence is under *this* headword: the example may contain an
                  inflected form (`Habéis` for `haber`), and a reader who sees a sentence
                  without their word in it deserves to know the match was on that form
                  rather than wonder whether the example is wrong. */}
              {example.matchedForm ? <>含 <b lang="es">{example.matchedForm}</b> · </> : null}
              <a href={tatoebaSentenceUrl(example.sentenceId)} target="_blank" rel="noreferrer noopener">#{example.sentenceId}</a>
              {example.sentenceOwner
                ? <> · <a href={tatoebaUserUrl(example.sentenceOwner)} target="_blank" rel="noreferrer noopener">{example.sentenceOwner}</a></>
                : null}
              {example.sentenceLicense ? <> · {example.sentenceLicense}</> : null}
              {example.translationOwner
                ? <> · 译文 <a href={tatoebaUserUrl(example.translationOwner)} target="_blank" rel="noreferrer noopener">{example.translationOwner}</a></>
                : null}
            </p>
          </li>)}
        </ul>
        <p className="vocabulary-study__tatoeba-source">例句来自 Tatoeba，按 CC BY 2.0 FR 使用。</p>
      </div>
      : null}
    </section> : null}

    {entry?.forms.length ? <section className="vocabulary-study__block" aria-labelledby="vocabulary-word-forms">
      <h4 id="vocabulary-word-forms">常见变位 / 形式</h4>
      <p className="vocabulary-study__chips" lang="es">{entry.forms.map((item) => <span key={item}>{item}</span>)}</p>
    </section> : null}

    {props.usageNotes.length || entry?.collocations.length ? <details className="vocabulary-study__details">
      <summary>用法与搭配</summary>
    {props.usageNotes.length ? <div className="vocabulary-study__block"><h4>词表用法</h4><ul className="vocabulary-study__examples">{props.usageNotes.map((note) => <li key={note}>{note}</li>)}</ul></div> : null}

    {entry?.collocations.length ? <div className="vocabulary-study__block"><h4>常用搭配</h4><p className="vocabulary-study__chips" lang="es">{entry.collocations.map((item) => <span key={item}>{item}</span>)}</p></div> : null}

    </details> : null}

    {/* Look up another word without going back to the shelf: the drawer's own input.
        A form, not a bare button, so Enter submits and a phone keyboard offers 前往. */}
    <form
      className="vocabulary-study__lookup"
      onSubmit={(event) => { event.preventDefault(); props.lookup.onSubmit(); }}
    >
      <label className="sr-only" htmlFor="vocabulary-lookup-input">查另一个词</label>
      <input
        id="vocabulary-lookup-input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="查另一个词"
        value={props.lookup.value}
        onChange={(event) => props.lookup.onChange(event.target.value)}
      />
      <button type="submit" disabled={props.lookup.state === "loading" || !props.lookup.value.trim()}>
        {props.lookup.state === "loading" ? "查询中" : "查"}
      </button>
    </form>
    {props.lookup.notice ? <p className="vocabulary-study__lookup-notice" role="status">{props.lookup.notice}</p> : null}

  </>;
}

const wordLookupEndpoint = "/api/v1/read/word-lookup";
const unsupportedSpeechNotice = "当前浏览器不支持音频播放，单词仍可正常学习。";

function loadTatoebaRecording(element: HTMLAudioElement, url: string, onProgress: () => void, onWaiting: () => void, onEnded: () => void, onError: () => void): void {
  element.onplaying = onProgress;
  element.ontimeupdate = onProgress;
  element.onwaiting = onWaiting;
  element.onended = onEnded;
  element.onerror = onError;
  element.preload = "none";
  element.src = url;
  element.currentTime = 0;
}

/** Releases the example recording while retaining its reusable element. */
function stopExampleAudio(element: HTMLAudioElement | null): void {
  if (!element) return;
  element.onplaying = null;
  element.ontimeupdate = null;
  element.onwaiting = null;
  element.onerror = null;
  element.onended = null;
  element.pause();
  element.removeAttribute("src");
  element.load();
}

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
        if (value === "familiar" || value === "learning" || value === "revisit" || value === "ignore") next[key] = value;
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

function autoplayStorageKey(scope: string): string {
  return `${autoplayStoragePrefix}${scope}`;
}

/**
 * Read as "on unless the reader turned it off": an absent, unreadable or malformed
 * value means the default, so a blocked `localStorage` (Safari private mode, a
 * hardened profile) cannot silently disable the feature the reader never chose to
 * disable.
 */
function readAutoplay(scope: string): boolean {
  try {
    return window.localStorage.getItem(autoplayStorageKey(scope)) !== "off";
  } catch {
    return true;
  }
}

function subscribeAutoplay(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(autoplayEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(autoplayEvent, callback);
  };
}

function writeAutoplay(scope: string, enabled: boolean): void {
  try {
    if (enabled) window.localStorage.removeItem(autoplayStorageKey(scope));
    else window.localStorage.setItem(autoplayStorageKey(scope), "off");
  } catch {
    // Ignore storage failures; the current session keeps its choice.
  }
  window.dispatchEvent(new Event(autoplayEvent));
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
export function VocabularyShelf({
  controls,
  children,
  storageScope,
  glossary,
  dictionary,
  bands,
  total,
  ranked,
}: VocabularyShelfProps) {
  // The bands' container: a plain ref again. It was briefly a callback ref so a component
  // could append to it, and that component is gone.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const decoratedRef = useRef<ReadonlySet<string>>(new Set());
  const describedRef = useRef<HTMLElement | null>(null);
  const hoveredTileRef = useRef<HTMLElement | null>(null);
  const hoveredBandRef = useRef<HTMLElement | null>(null);
  /** The hovered tile's list row: the first four rows carry a filled transform. */
  const hoveredRowRef = useRef<HTMLElement | null>(null);
  /** The portalled layer, so moving onto its buttons is not "leaving the word". */
  const layerRef = useRef<HTMLDivElement | null>(null);
  /** The pending close, so entering the card or its bridge can cancel it. */
  const hideTimerRef = useRef<number | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);
  const selectedTileRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const shelfAnchorRef = useRef<{ tile: HTMLElement; top: number } | null>(null);
  const shelfAnchorFrameRef = useRef<number | null>(null);
  const panelInOverlay = useMediaQuery(wordPanelOverlayQuery);
  // Measure only on explicit open/close; scrolling does no geometry work.
  const rememberShelfPosition = useCallback((tile = selectedTileRef.current) => {
    if (shelfAnchorFrameRef.current !== null) {
      cancelAnimationFrame(shelfAnchorFrameRef.current);
      shelfAnchorFrameRef.current = null;
    }
    shelfAnchorRef.current = !panelInOverlay && tile?.isConnected
      ? { tile, top: tile.getBoundingClientRect().top } : null;
  }, [panelInOverlay]);
  /** One reusable media element for Tatoeba example recordings. */
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  /** One read is one generation: a late reply must never touch a newer state. */
  const readGenerationRef = useRef(0);
  const exampleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exampleNotice, setExampleNotice] = useState<{ sentenceId: number; text: string } | null>(null);
  /** Which card is sounding, readable from callbacks that must not re-render. */
  const readOriginRef = useRef<ReadOrigin | null>(null);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  useLayoutEffect(() => {
    const anchor = shelfAnchorRef.current;
    shelfAnchorRef.current = null;
    if (anchor?.tile.isConnected && !panelInOverlay) {
      const correct = () => {
        if (!anchor.tile.isConnected) return;
        const delta = anchor.tile.getBoundingClientRect().top - anchor.top;
        if (Math.abs(delta) > 1) window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
      };
      correct();
      // content-visibility bands above the target update their remembered heights
      // as the new grid width paints. Settle those finite layout frames too; this
      // is bounded to an explicit action and never observes ongoing scrolling.
      let remaining = 6;
      const settle = () => {
        shelfAnchorFrameRef.current = null;
        correct();
        if (--remaining > 0) shelfAnchorFrameRef.current = requestAnimationFrame(settle);
      };
      shelfAnchorFrameRef.current = requestAnimationFrame(settle);
    }
  }, [selected, panelInOverlay]);
  useEffect(() => () => {
    if (shelfAnchorFrameRef.current !== null) cancelAnimationFrame(shelfAnchorFrameRef.current);
  }, []);
  useLayoutEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [selected?.word, panelInOverlay]);
  const panelOpen = selected !== null;
  useEffect(() => {
    if (!panelOpen || !panelInOverlay) return;
    const panel = panelRef.current;
    if (!panel) return;
    const previousFocus = document.activeElement;
    const shell = document.querySelector<HTMLElement>(".product-shell");
    const previousInert = shell?.inert ?? false;
    const previousOverflow = document.body.style.overflow;
    const focusable = () => [...panel.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], summary")]
      .filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus({ preventScroll: true });
    if (shell) shell.inert = true;
    document.body.style.overflow = "hidden";
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onTab);
    return () => {
      document.removeEventListener("keydown", onTab);
      if (shell) shell.inert = previousInert;
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [panelOpen, panelInOverlay]);
  const [notice, setNotice] = useState("");
  const [readAloud, setReadAloud] = useState<ReadAloud | null>(null);
  const [activeMilestone, setActiveMilestone] = useState(1);
  const [practiceActive, setPracticeActive] = useState(false);
  const statuses = useSyncExternalStore(subscribeStatuses, () => readStatuses(storageScope), () => emptyStatuses);
  // The third argument is the server render: a reader with no choice stored yet
  // gets the default, and the markup matches what the server sent.
  const autoplay = useSyncExternalStore(
    useCallback((callback: () => void) => subscribeAutoplay(callback), []),
    () => readAutoplay(storageScope),
    () => true,
  );
  const speech = useReadAloud();
  const speakingId = speech.speakingId;
  const speakWithBrowser = speech.speak;
  const stopBrowserSpeech = speech.stop;
  /**
   * The sound actually in flight. The browser voice reports its own end through
   * `speech.speakingId`, so a finished synthetic read is dropped here rather
   * than ended a second time by this frame.
   */
  const activeRead = (readAloud?.phase === "synthetic" || readAloud?.phase === "tatoeba-synthetic") && speakingId !== readAloud.key ? null : readAloud;

  /** Clears the example recording's startup/stall deadline. */
  const clearExampleTimeout = useCallback(() => {
    if (exampleTimeoutRef.current !== null) {
      clearTimeout(exampleTimeoutRef.current);
      exampleTimeoutRef.current = null;
    }
  }, []);

  /**
   * Stops everything this frame can be sounding — the recording and the browser
   * voice — and moves the generation on, so a callback still in flight is dropped
   * instead of starting a sound nobody asked for any more.
   */
  const stopReadAloud = useCallback(() => {
    readGenerationRef.current += 1;
    readOriginRef.current = null;
    clearExampleTimeout();
    stopExampleAudio(audioElementRef.current);
    stopBrowserSpeech();
    setReadAloud(null);
    setNotice("");
    setExampleNotice(null);
  }, [stopBrowserSpeech, clearExampleTimeout]);

  const toggleExample = useCallback((example: TatoebaExample) => {
    const alreadyActive = (readAloud?.phase === "tatoeba" || readAloud?.phase === "tatoeba-synthetic") && readAloud.sentenceId === example.sentenceId;
    stopReadAloud();
    if (alreadyActive) return;
    const generation = readGenerationRef.current;
    if (!example.audio) {
      const key = `tatoeba-synthetic:${example.sentenceId}`;
      const finish = (message?: string) => {
        if (readGenerationRef.current !== generation) return;
        stopReadAloud();
        if (message) setExampleNotice({ sentenceId: example.sentenceId, text: message });
      };
      readOriginRef.current = "card";
      setReadAloud({ phase: "tatoeba-synthetic", origin: "card", key, sentenceId: example.sentenceId, playback: "loading" });
      speakWithBrowser(key, example.text, () => finish("当前浏览器不支持合成朗读。"), {
        onStart: () => {
          if (readGenerationRef.current !== generation) return;
          setReadAloud((current) => current?.phase === "tatoeba-synthetic" ? { ...current, playback: "playing" } : current);
        },
        onEnd: () => finish(),
        onError: finish,
      });
      return;
    }
    const audio = audioElementRef.current ?? new Audio();
    audioElementRef.current = audio;
    const finish = (failed: boolean) => {
      if (readGenerationRef.current !== generation) return;
      stopReadAloud();
      if (failed) setExampleNotice({ sentenceId: example.sentenceId, text: "例句原声暂时无法播放，请重试。" });
    };
    let lastPosition = 0;
    const armProgressTimeout = () => {
      if (exampleTimeoutRef.current !== null) clearTimeout(exampleTimeoutRef.current);
      exampleTimeoutRef.current = setTimeout(() => finish(true), 20_000);
    };
    loadTatoebaRecording(audio, example.audio.url, () => {
      if (readGenerationRef.current !== generation) return;
      // `playing` can fire while a media pipeline remains stuck at zero.
      // Only actual progress renews the deadline, including after buffering.
      if (!Number.isFinite(audio.currentTime) || audio.currentTime <= lastPosition) return;
      lastPosition = audio.currentTime;
      armProgressTimeout();
      setReadAloud((current) => current?.phase === "tatoeba" && current.playback !== "playing"
        ? { ...current, playback: "playing" } : current);
    }, () => {
      if (readGenerationRef.current !== generation) return;
      setReadAloud((current) => current?.phase === "tatoeba" && current.playback !== "loading"
        ? { ...current, playback: "loading" } : current);
    }, () => finish(false), () => finish(true));
    readOriginRef.current = "card";
    setReadAloud({ phase: "tatoeba", origin: "card", key: `tatoeba:${example.sentenceId}`, sentenceId: example.sentenceId, playback: "loading" });
    // Playback is started synchronously in the user gesture for iPhone Safari.
    armProgressTimeout();
    try { void audio.play().catch(() => finish(true)); } catch { finish(true); }
  }, [readAloud, speakWithBrowser, stopReadAloud]);

  /** Leaving one card must not silence the other card's sound. */
  const stopReadFrom = useCallback((origin: ReadOrigin) => {
    if (readOriginRef.current === origin) stopReadAloud();
  }, [stopReadAloud]);

  /**
   * Build the panel's word from a shelf entry: the glossary's reviewed detail when
   * it has the word, and Language Reactor's translations when the asset does. Either
   * source may be missing, so every field is optional here rather than assumed.
   */
  const entryFor = useCallback((key: string, word: string): Selected => {
    const reviewed = glossary[key] ?? null;
    const display = displayMeanings({ languageReactor: dictionary[key], glossary: reviewed?.meanings });
    // The reviewed usage notes are shown beside Language Reactor's translations, so
    // they come from the reviewed entry whether or not LR supplied the meanings.
    const notes = reviewed?.meanings.map((meaning) => meaning.usage).filter((usage) => usage.trim().length > 0) ?? [];
    return {
      key,
      word,
      example: null,
      source: null,
      meanings: display,
      usageNotes: notes,
      cefr: reviewed?.cefr ?? null,
      partOfSpeech: reviewed?.partOfSpeech ?? null,
      collocations: reviewed?.collocations ?? [],
      examples: reviewed?.examples ?? [],
      forms: reviewed?.forms ?? [],
      tatoeba: reviewed?.tatoeba ?? [],
    };
  }, [dictionary, glossary]);

  /** The lookup form's own state; the panel renders it and the frame owns it. */
  const [lookupValue, setLookupValue] = useState("");
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "missing" | "error">("idle");
  const lookupGenerationRef = useRef(0);
  /**
   * Tatoeba examples, fetched the first time a word is opened.
   *
   * The page no longer ships them: every word's examples measured 737 KB of the document, and
   * only the word a reader opens needs its own. This map is the same shape the page used to
   * pass, so the panel reads it without knowing where it came from — and a word looked up by
   * name arrives with its examples already, because that route returns them.
   */
  const [examplesByWord, setExamplesByWord] = useState<Readonly<Record<string, readonly TatoebaExample[]>>>({});
  const examplesRequested = useRef(new Set<string>());

  const loadExamples = useCallback((key: string) => {
    if (examplesRequested.current.has(key)) return;
    examplesRequested.current.add(key);
    void fetch(`${wordLookupEndpoint}?fields=tatoeba`, {
      body: JSON.stringify({ word: key }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const data = payload && typeof payload === "object" ? (payload as { data?: { tatoeba?: readonly TatoebaExample[] } }).data : null;
        if (!data) return;
        const examples = data.tatoeba ?? [];
        if (!examples.length) return;
        setExamplesByWord((current) => ({ ...current, [key]: examples }));
      })
      .catch(() => {
        // A word without examples shows no example section, which is the same thing the
        // panel shows for a word Tatoeba has nothing for. Nothing to report to the reader.
      });
  }, []);

  /** Attach whatever examples are known for a word, fetching them once if they are not. */
  const withExamples = useCallback((candidate: Selected): Selected => {
    const known = examplesByWord[candidate.key];
    if (known) return { ...candidate, tatoeba: known };
    loadExamples(candidate.key);
    return candidate;
  }, [examplesByWord, loadExamples]);

  /**
   * The examples to show for the selection.
   *
   * Derived rather than copied into state by an effect: the fetch lands after the word is
   * opened, and an effect that wrote it back into the selection would be a cascading render
   * for something that is simply "the latest value of two sources". A word looked up by name
   * already carries its own; a word opened from a tile gets them from the map once fetched.
   */
  const selectedExamples = selected ? examplesByWord[selected.key] ?? selected.tatoeba : [];

  /**
   * Look up a word the shelf is not showing.
   *
   * The route answers with exactly what the page would have put on a tile and in the
   * frame's glossary, so a looked-up word gets the same panel as a clicked one. The
   * generation counter drops a reply whose form was already submitted again — the
   * same discipline `startRead` uses for audio, and the same one Language Reactor
   * uses for its drawer.
   */
  const requestLookup = useCallback(() => {
    const wanted = lookupValue.trim();
    if (!wanted) return;
    lookupGenerationRef.current += 1;
    const generation = lookupGenerationRef.current;
    setLookupState("loading");
    void fetch(wordLookupEndpoint, {
      body: JSON.stringify({ word: wanted }),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        if (lookupGenerationRef.current !== generation) return;
        const data = payload && typeof payload === "object" ? (payload as { data?: WordLookupResponse }).data : null;
        if (!data) {
          setLookupState("error");
          return;
        }
        if (!data.found) {
          setLookupState("missing");
          return;
        }
        // Reveal the word it found, and let the shelf show it too, so the panel and
        // the list agree about what is being looked at.
        selectedTileRef.current = null;
        setSelected({
          key: data.markKey ?? data.word,
          word: data.word,
          example: data.context ?? null,
          source: data.sourceTitle ?? null,
          meanings: { meanings: data.meanings ?? [], source: data.meaningSource ?? "none" },
          usageNotes: data.usageNotes ?? [],
          cefr: data.cefr ?? null,
          partOfSpeech: data.partOfSpeech ?? null,
          collocations: data.collocations ?? [],
          examples: data.examples ?? [],
          forms: data.forms ?? [],
          tatoeba: data.tatoeba ?? [],
        });
        setLookupState("idle");
      })
      .catch(() => {
        if (lookupGenerationRef.current !== generation) return;
        setLookupState("error");
      });
  }, [lookupValue]);

  const hideTranslation = useCallback(() => {
    cancelHide();
    // Closing the layer closes its sound too: unhover, blur, Escape and another
    // word taking over all run through here.
    stopReadFrom("layer");
    describedRef.current?.removeAttribute("aria-describedby");
    describedRef.current = null;
    hoveredTileRef.current = null;
    // The hovered band and row only carry the classes that let the layer out.
    hoveredBandRef.current?.classList.remove("is-hovered");
    hoveredBandRef.current = null;
    hoveredRowRef.current?.classList.remove("is-hovered");
    hoveredRowRef.current = null;
    setHovered(null);
  }, [cancelHide, stopReadFrom]);

  /**
   * The close is delayed by 120 ms — Language Reactor's popup closes 100 ms after
   * `mouseleave` — but the delay is not what keeps the card reachable. What keeps
   * it reachable is that nothing between the word and the buttons is a dead zone:
   * the card and its buttons are one box (no gap to fall through), the 6px between
   * the word and the card is an invisible bridge, and entering either one cancels
   * a pending close.
   */
  const scheduleHide = useCallback((tile: HTMLElement) => {
    cancelHide();
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (hoveredTileRef.current !== tile) return;
      hideTranslation();
    }, 120);
  }, [cancelHide, hideTranslation]);

  const showTranslation = useCallback((tile: HTMLElement) => {
    const key = tile.dataset.wordKey ?? "";
    // Same rule the tile's own meaning was built with, so the two can never
    // disagree about which meaning leads.
    const display = displayMeanings({ languageReactor: dictionary[key], glossary: glossary[key]?.meanings });
    if (!display.meanings.length) {
      // Neither source has this word: the tile's own placeholder already
      // answers, and inventing a translation here is exactly what must not
      // happen.
      hideTranslation();
      return;
    }
    // `content-visibility: auto` makes a band a stacking context with paint
    // containment, which would clip this layer to the band and paint it under the
    // bands that follow. Moving the class off the previous band and onto this one
    // is a single DOM write per hover — nothing on the scroll path.
    const band = tile.closest<HTMLElement>("[data-band-start]");
    if (band !== hoveredBandRef.current) {
      hoveredBandRef.current?.classList.remove("is-hovered");
      band?.classList.add("is-hovered");
      hoveredBandRef.current = band;
    }
    // The first four grid children carry the entrance animation's filled
    // `transform`, which makes each of them its own stacking context: a layer
    // inside one of those rows is trapped in it and the later rows paint over it.
    // Lifting the row itself is the same one-write trick one level down.
    const row = tile.parentElement;
    if (row && row !== hoveredRowRef.current) {
      hoveredRowRef.current?.classList.remove("is-hovered");
      row.classList.add("is-hovered");
      hoveredRowRef.current = row;
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
    // Another word is taking the layer over, so the one that was speaking stops.
    if (hoveredTileRef.current !== tile) stopReadFrom("layer");
    hoveredTileRef.current = tile;
    // No coordinates: the layer is rendered into the word's own row and CSS
    // anchors it there, so scrolling never needs a geometry read.
    setHovered({ key, word: tile.dataset.word ?? "", meanings: display.meanings, container });
  }, [dictionary, glossary, hideTranslation, stopReadFrom]);

  const selectTile = useCallback((tile: HTMLElement) => {
    rememberShelfPosition(tile);
    const key = tile.dataset.wordKey ?? "";
    // Opening, closing or moving the word's card leaves the previous word's sound
    // behind, whichever card started it.
    stopReadAloud();
    hideTranslation();
    // Accent-folded keys repeat on the shelf (`solo`/`sólo` share one mark key),
    // so the *clicked tile* decides what is selected, not the key.
    const closing = selectedTileRef.current === tile;
    selectedTileRef.current = closing ? null : tile;
    const word = tile.dataset.word ?? "";
    if (closing) {
      setSelected(null);
      return;
    }
    // The tile carries its own excerpt and source; the meanings and reviewed detail
    // come from the page's maps, through the same builder the lookup route uses.
    const fromShelf = entryFor(key, word);
    // Tatoeba's examples are fetched per opened word rather than shipped for all 7,922 of
    // them (they measured 737 KB of the document). `withExamples` attaches them when they are
    // already known and starts the single fetch otherwise; the effect below puts them on
    // screen when that fetch lands, so the panel fills them in without a second click.
    setSelected(withExamples({
      ...fromShelf,
      example: tile.dataset.example ?? null,
      source: tile.dataset.source ?? null,
    }));
  }, [entryFor, hideTranslation, stopReadAloud, withExamples, rememberShelfPosition]);

  const markStatus = useCallback((markKey: string, status: VocabularyShelfStatus) => {
    const next = { ...readStatuses(storageScope) };
    if (next[markKey] === status) delete next[markKey];
    else next[markKey] = status;
    writeStatuses(storageScope, next);
  }, [storageScope]);

  /** Word pronunciation always reads the displayed word, within the user gesture. */
  const startRead = useCallback((origin: ReadOrigin, key: string, word: string) => {
    stopReadAloud();
    const generation = readGenerationRef.current;
    readOriginRef.current = origin;
    setReadAloud({ phase: "loading", origin, key });
    const finish = (message = "") => {
      if (readGenerationRef.current !== generation) return;
      readOriginRef.current = null;
      setReadAloud(null);
      setNotice(message);
    };
    speakWithBrowser(key, word, () => finish(unsupportedSpeechNotice), {
      onStart: () => {
        if (readGenerationRef.current === generation) setReadAloud({ phase: "synthetic", origin, key });
      },
      onEnd: () => finish(),
      onError: (message) => finish(message),
    });
  }, [speakWithBrowser, stopReadAloud]);

  /** A second click on the word that is loading or sounding is its stop. */
  const toggleReadAloud = useCallback((origin: ReadOrigin, key: string, word: string) => {
    if (activeRead && activeRead.key === key) stopReadAloud();
    else startRead(origin, key, word);
  }, [activeRead, startRead, stopReadAloud]);

  /**
   * Opening a word pronounces it, in the same gesture that opens the panel.
   *
   * This is Language Reactor's `speakWordOnClick`, and it is what makes a click
   * mean "show me this word" rather than "show me a card, and then I will ask for
   * the sound". `startRead` runs inside the click handler rather than after an
   * await, so the gesture the autoplay policy checks is still the click.
   *
   * Closing by clicking the same word again does not re-read it, and neither does
   * a re-render: this is called from the click path only. It is defined after
   * `startRead` so the callback can capture it after initialization.
   *
   * "Say it on open" is the reader's choice, not a fixed law: with the switch off
   * the panel still opens and the read button still reads, so turning the sound off
   * never costs the feature.
   */
  const openTile = useCallback((tile: HTMLElement) => {
    const wasOpen = selectedTileRef.current === tile;
    selectTile(tile);
    const word = tile.dataset.word ?? "";
    if (autoplay && !wasOpen && word) startRead("card", tile.dataset.wordKey ?? "", word);
  }, [autoplay, selectTile, startRead]);

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
        tile.classList.toggle("is-learning", on && status === "learning");
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

  useEffect(() => () => {
    cancelHide();
    describedRef.current?.removeAttribute("aria-describedby");
    hoveredBandRef.current?.classList.remove("is-hovered");
    hoveredRowRef.current?.classList.remove("is-hovered");
  }, [cancelHide]);

  // Hiding or leaving the page stops word TTS and example playback together.
  //
  // Escape is handled here rather than only on the shelf container because the
  // read button lives in the panel: after a click the focus is in the sidebar, so
  // a container-scoped handler never saw the key and the sound kept playing while
  // the panel stayed open. One dismissal now closes the panel, the hover layer and
  // the sound together, wherever the focus happens to be.
  useEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) stopReadAloud(); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      rememberShelfPosition();
      stopReadAloud();
      hideTranslation();
      selectedTileRef.current = null;
      setSelected(null);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [hideTranslation, stopReadAloud, rememberShelfPosition]);

  // Unmounting cancels speech and releases the example recording's source.
  useEffect(() => () => {
    readGenerationRef.current += 1;
    clearExampleTimeout();
    stopExampleAudio(audioElementRef.current);
    stopBrowserSpeech();
  }, [stopBrowserSpeech, clearExampleTimeout]);

  // Closing the panel while its focus is still inside would leave the focus on a
  // node that is no longer on screen: the next Tab would continue from a hidden
  // element and a screen reader would announce nothing. Language Reactor blurs the
  // same way when its drawer closes.
  useEffect(() => {
    if (selected) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".vocabulary-study__card")) active.blur();
  }, [selected]);

  // The card is wider than one tile, so in the right-hand columns it would run off
  // the page. One measurement per hover — deliberately not per frame: the scroll
  // path stays free of geometry reads, which is what the guard test and the scroll
  // measurements protect. The wrapper spans the row, so the *card* is what gets
  // measured.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const card = layer.querySelector<HTMLElement>(".vocabulary-shelf__translation");
    const measured = (card ?? layer).getBoundingClientRect();
    layer.classList.toggle("is-flipped", measured.right > window.innerWidth - 8 && measured.left - measured.width >= 8);
  }, [hovered]);

  const marked = Object.keys(statuses).length;
  const visibleNotice = speech.errorMessage || notice;
  // Below 1200px the panel cannot be a grid column: `position: fixed` resolves
  // against the nearest transformed ancestor, and `.page-stack` carries an
  // identity `transform`, so a fixed sheet left in the grid renders above the
  // viewport (measured `top: -437px` in a 390×844 viewport). It becomes a bottom
  // sheet or side drawer portalled to `body`; larger desktops keep a sticky
  // column beside the shelf. The media query is owned by this vocabulary layout.
  /**
   * Whether this open pushed a history entry, so Back closes the panel instead of
   * leaving the page — Language Reactor's drawer does the same (`pushState` plus a
   * `popstate` handler).
   *
   * The entry is pushed when a word is *opened* and consumed when the panel is closed
   * by any other means, so closing with the 关闭 button does not leave a step behind
   * that would make Back a no-op. `selected` is what decides; the refs only record who
   * owns the step in the history stack.
   */
  const panelHistoryRef = useRef(false);
  const openedRef = useRef(false);
  const closeFromHistoryRef = useRef(false);
  const previousScrollRestorationRef = useRef<ScrollRestoration | null>(null);
  const restorationFrameRef = useRef<number | null>(null);
  const releaseScrollRestoration = useCallback(() => {
    // Native Back restores its saved scroll after popstate. Keep it manual until
    // that navigation finishes, so it cannot overwrite the word's layout anchor.
    if (restorationFrameRef.current !== null) cancelAnimationFrame(restorationFrameRef.current);
    restorationFrameRef.current = requestAnimationFrame(() => {
      restorationFrameRef.current = null;
      if (openedRef.current) return;
      if (previousScrollRestorationRef.current !== null) {
        window.history.scrollRestoration = previousScrollRestorationRef.current;
        previousScrollRestorationRef.current = null;
      }
    });
  }, []);
  useEffect(() => {
    const isOpen = selected !== null;
    if (isOpen && !openedRef.current) {
      openedRef.current = true;
      if (restorationFrameRef.current !== null) {
        cancelAnimationFrame(restorationFrameRef.current);
        restorationFrameRef.current = null;
      }
      previousScrollRestorationRef.current ??= window.history.scrollRestoration ?? "auto";
      window.history.scrollRestoration = "manual";
      // The pushed entry is marked, so a reader who navigates forward again and comes
      // back to it does not reopen anything.
      window.history.pushState({ vocabularyPanel: true }, "");
      panelHistoryRef.current = true;
    } else if (!isOpen && openedRef.current) {
      openedRef.current = false;
      if (panelHistoryRef.current) {
        panelHistoryRef.current = false;
        // Leave the stack the way a reader expects: the panel closed, the page where
        // it was, and Back still meaning "the page before this one". Suppress the
        // popstate handler for this one step, so consuming our own entry is not read
        // as the reader pressing Back.
        closeFromHistoryRef.current = true;
        window.history.back();
      }
    }
  }, [selected]);

  useEffect(() => {
    const onPopState = () => {
      // This popstate is our own `back()` tidying up after a close that already
      // happened, not the reader pressing Back.
      if (closeFromHistoryRef.current) {
        closeFromHistoryRef.current = false;
        releaseScrollRestoration();
        return;
      }
      // The reader pressed Back with the panel open: the entry is already gone, so the
      // state clears without asking for another `back()`.
      panelHistoryRef.current = false;
      openedRef.current = false;
      rememberShelfPosition();
      setSelected(null);
      stopReadAloud();
      selectedTileRef.current = null;
      releaseScrollRestoration();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [stopReadAloud, rememberShelfPosition, releaseScrollRestoration]);

  /**
   * Leaving the page with the panel open must not leave its history entry behind: the
   * next page would then need two Backs to leave. The listener goes first, so this
   * tidy-up is not mistaken for the reader pressing Back.
   */
  useEffect(() => () => {
    if (restorationFrameRef.current !== null) cancelAnimationFrame(restorationFrameRef.current);
    if (previousScrollRestorationRef.current !== null) window.history.scrollRestoration = previousScrollRestorationRef.current;
    if (!panelHistoryRef.current) return;
    panelHistoryRef.current = false;
    openedRef.current = false;
    closeFromHistoryRef.current = true;
    window.history.back();
  }, []);

  /** Closing the panel also silences it: a recording must not outlive its source. */
  const closePanel = useCallback(() => {
    rememberShelfPosition();
    stopReadAloud();
    hideTranslation();
    selectedTileRef.current = null;
    setSelected(null);
  }, [stopReadAloud, rememberShelfPosition, hideTranslation]);
  // The sound is one, so the panel only takes its read state from the word it
  // shows: a sound started for another word is not this panel's control state.
  const selectedRead = activeRead && selected && activeRead.key === selected.key ? activeRead : null;
  // The lookup form's own line, said in the panel where the form is. A word the
  // reference list does not carry is a real answer, not a failure, and it reads like
  // one; a transport failure is the only thing called an error.
  const lookupNotice = lookupState === "missing"
    ? "参考词表里没有这个词，换一个拼写试试。"
    : lookupState === "error"
      ? "查询暂时不可用，请稍后重试。"
      : "";
  // The panel's entry, built once from the selection rather than inline at each of the
  // two render sites: the shape has grown, and two hand-written copies would be the
  // one that drifts when a field is added.
  const selectedEntry: VocabularyShelfGlossary | null = selected
    ? {
      cefr: selected.cefr ?? "",
      partOfSpeech: selected.partOfSpeech ?? "",
      meanings: selected.meanings?.meanings ?? [],
      collocations: selected.collocations,
      examples: selected.examples,
      forms: selected.forms,
      tatoeba: selectedExamples,
    }
    : null;
  const milestones = ranked && total > vocabularyRankBandSize ? reachableRankMilestones(total) : [];

  return <section className="vocabulary-study" aria-label="词汇表">
    <div className="vocabulary-toolbar">
      {practiceActive ? <span className="vocabulary-recall__help">退出默写后可搜索词表</span> : controls}
      {marked ? <p className="vocabulary-study__summary" aria-live="polite" title="标记仅保存在当前浏览器">已标记 {marked} 个</p> : null}
    <label className="vocabulary-study__autoplay" title="点击单词时自动朗读">
      <input
        type="checkbox"
        aria-label="点词自动发音"
        checked={autoplay}
        disabled={practiceActive}
        onChange={(event) => writeAutoplay(storageScope, event.target.checked)}
      />
      <span className="vocabulary-study__autoplay-track" aria-hidden="true" />
      <span>自动发音</span>
    </label>
    </div>

    <VocabularyRecall
      key={storageScope}
      containerRef={containerRef}
      statuses={statuses}
      meaningsFor={(key) => displayMeanings({ languageReactor: dictionary[key], glossary: glossary[key]?.meanings }).meanings.map((meaning) => meaning.meaning)}
      onActiveChange={setPracticeActive}
      onBegin={() => { rememberShelfPosition(); stopReadAloud(); hideTranslation(); selectedTileRef.current = null; setSelected(null); }}
    />

    <div className="vocabulary-shelf__body">
      <div className="vocabulary-shelf__main">
      <div
        className="vocabulary-shelf__bands"
        ref={containerRef}
        onMouseOver={(event) => { if (practiceActive) return; const tile = tileFrom(event.target); if (tile) showTranslation(tile); }}
        onMouseOut={(event) => {
          const tile = tileFrom(event.target);
          if (!tile) return;
          const next = event.relatedTarget as Node | null;
          // The word and its card are one hover group: the row holds both, so
          // moving from the word onto the card — at any speed, by any path that
          // stays in the row — is not leaving, and it cancels a pending close.
          if (next && tile.parentElement?.contains(next)) { cancelHide(); return; }
          scheduleHide(tile);
        }}
        onFocus={(event) => { if (practiceActive) return; const tile = tileFrom(event.target); if (tile) showTranslation(tile); }}
        onBlur={(event) => {
          if (!tileFrom(event.target)) return;
          // Tabbing from the word into the layer's buttons keeps it open. Blur
          // does not always carry `relatedTarget` (jsdom never does, and some
          // browsers omit it), so the active element decides on the next tick —          // one timeout per focus change, nothing on the scroll path.
          const next = event.relatedTarget as Node | null;
          if (next && layerRef.current?.contains(next)) return;
          window.setTimeout(() => {
            const active = document.activeElement;
            if (active && (layerRef.current?.contains(active) || hoveredTileRef.current?.contains(active))) return;
            hideTranslation();
          }, 0);
        }}
        onClick={(event) => { if (practiceActive) return; const tile = tileFrom(event.target); if (tile) openTile(tile); }}
      >
        {children}
      </div>

      {milestones.length ? <nav className="vocabulary-rank-rail" aria-label="按名次跳转">
        {milestones.map((rank) => <a
          key={rank}
          href={`#${rankBandAnchor(rank, total)}`}
          aria-current={rank === activeMilestone ? "true" : undefined}
          aria-label={`跳到第 ${rankMilestoneLabel(rank)} 名`}
        >{rankMilestoneLabel(rank)}</a>)}
      </nav> : null}
      </div>

      {/* Below 1200px the panel leaves this grid and becomes an overlay on
          `body`: `position: fixed` resolves against the nearest transformed
          ancestor, and `.page-stack` carries an identity `transform`, so a fixed
          sheet left inside the grid rendered above the viewport (measured
          `top: -437px` at 390×844). The portal is the same escape the hover layer
          already uses. On a desktop it stays here, where its grid column sizes it
          and `position: sticky` works. */}
      {selected && !panelInOverlay ? <aside ref={panelRef} className="vocabulary-study__card" aria-live="polite" aria-label={`${selected.word} 词汇卡片`}>
        <WordPanelContent
          key={selected.word}
          word={selected.word}
          meanings={selected.meanings}
          usageNotes={selected.usageNotes}
          entry={selectedEntry}
          example={selected.example}
          source={selected.source}
          tatoeba={selectedExamples}
          exampleRead={activeRead?.phase === "tatoeba" || activeRead?.phase === "tatoeba-synthetic" ? activeRead : null}
          exampleNotice={exampleNotice}
          onToggleExample={toggleExample}
          statuses={statuses}
          readPhase={selectedRead?.phase === "tatoeba" || selectedRead?.phase === "tatoeba-synthetic" ? null : selectedRead?.phase ?? null}
          readNotice={visibleNotice}
          lookup={{ value: lookupValue, state: lookupState, notice: lookupNotice, onChange: setLookupValue, onSubmit: requestLookup }}
          onToggleRead={() => toggleReadAloud("card", selected.key, selected.word)}
          onMark={(status) => markStatus(selected.key, status)}
          onClearMark={(status) => markStatus(selected.key, status)}
          onClose={closePanel}
          />
      </aside> : null}
    </div>

    {/* Rendered into the hovered word's own list row and anchored by CSS: it
        follows the word with no geometry read, and no scroll listener exists to
        keep it in place. Portalled because the page wrapper carries a
        `transform` (its entrance animation), which would otherwise become the
        containing block for anything positioned. */}
    {hovered ? createPortal(<div
      className="vocabulary-shelf__translation-layer"
      id={translationLayerId}
      ref={layerRef}
      // Entering the layer — the card, its buttons, or the bridge over the 6px
      // between the word and the card — cancels a pending close. That is Language
      // Reactor's `cancelHide()`, and it is what makes a slow hand safe.
      onMouseOver={() => cancelHide()}
      onMouseOut={(event) => {
        const next = event.relatedTarget as Node | null;
        // Back onto the word, or elsewhere inside the layer, is not leaving.
        // Anything else closes at once, so a stale card never shadows a
        // neighbour.
        if (next && (layerRef.current?.contains(next) || hoveredTileRef.current?.contains(next))) return;
        hideTranslation();
      }}
      onKeyDown={(event) => { if (event.key === "Escape") hideTranslation(); }}
    >
      {/* The card and its buttons are one box: no gap, no seam, no strip between
          them without a hit target. That dead zone is precisely what made the
          buttons unreachable — a pointer crossing it landed on the row below and
          the card re-targeted away. The `tooltip` element stays the meanings
          alone, so the description assistive tech reads is unchanged. */}
      <div className="vocabulary-shelf__translation-card">
        <div className="vocabulary-shelf__translation" id={translationId} role="tooltip">
          {/* The word is not repeated: the reader is hovering it. */}
          <ul className="vocabulary-shelf__translation-meanings">
            {hovered.meanings.map((meaning) => <li key={meaning.meaning}>
              <strong>{meaning.meaning}</strong>
              {meaning.usage ? <span>{meaning.usage}</span> : null}
            </li>)}
          </ul>
        </div>

        {/* The two states a reader reaching for the mouse most likely wants. The
            glyph is the button's visible face; the name is on the button, and the
            label appears for hover *and* focus, so a keyboard user is not left
            with two unlabelled marks. */}
        <div className="vocabulary-shelf__translation-actions" role="group" aria-label={`标记 ${hovered.word}`}>
          {quickStatusOptions.map(([value, label]) => <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={statuses[hovered.key] === value}
            className={statuses[hovered.key] === value ? "is-active" : undefined}
            onClick={() => markStatus(hovered.key, value)}
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 20 20">
              {value === "familiar"
                ? <path d="M4.5 10.5l3.2 3.2 7.3-7.3" />
                : <><path d="M4 4.5h9.5a2 2 0 0 1 2 2v9H6a2 2 0 0 1-2-2z" /><path d="M7 8.5h6" /></>}
            </svg>
            <span className="vocabulary-shelf__translation-actions-label">{label}</span>
          </button>)}
        </div>
      </div>
    </div>, hovered.container) : null}

    {/* The same panel at narrower widths: an overlay on `body`, with a backdrop so
        tapping outside dismisses it. It cannot stay in the grid there because
        `position: fixed` resolves against the nearest transformed ancestor, and
        `.page-stack` carries an identity `transform` — a fixed sheet left in the
        grid rendered above the viewport (measured `top: -437px` at 390×844). */}
    {selected && panelInOverlay ? createPortal(<>
      <div
        className="vocabulary-study__card-backdrop"
        data-testid="word-panel-backdrop"
        onClick={closePanel}
      />
      <aside ref={panelRef} role="dialog" aria-modal="true" className="vocabulary-study__card vocabulary-study__card--overlay" aria-live="polite" aria-label={`${selected.word} 词汇卡片`}>
        <WordPanelContent
          key={selected.word}
          word={selected.word}
          meanings={selected.meanings}
          usageNotes={selected.usageNotes}
          entry={selectedEntry}
          example={selected.example}
          source={selected.source}
          tatoeba={selectedExamples}
          exampleRead={activeRead?.phase === "tatoeba" || activeRead?.phase === "tatoeba-synthetic" ? activeRead : null}
          exampleNotice={exampleNotice}
          onToggleExample={toggleExample}
          statuses={statuses}
          readPhase={selectedRead?.phase === "tatoeba" || selectedRead?.phase === "tatoeba-synthetic" ? null : selectedRead?.phase ?? null}
          readNotice={visibleNotice}
          lookup={{ value: lookupValue, state: lookupState, notice: lookupNotice, onChange: setLookupValue, onSubmit: requestLookup }}
          onToggleRead={() => toggleReadAloud("card", selected.key, selected.word)}
          onMark={(status) => markStatus(selected.key, status)}
          onClearMark={(status) => markStatus(selected.key, status)}
          onClose={closePanel}
          />
      </aside>
    </>, document.body) : null}
  </section>;
}
