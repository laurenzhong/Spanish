"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { ArticleReaderProjection, ArticleReaderSegment, ArticleTransferType } from "@/src/modules/content/domain";
import { articleTransferTask, articleTransferTypes, recommendedArticleTransferType } from "@/src/modules/content/domain";
import { readingStatePatchSchema } from "@/src/modules/reading/domain/reading-state";
import {
  createReadAloud,
  readAloudErrorMessage,
} from "@/src/modules/providers/tts";
import type { WordExplanation } from "@/src/modules/providers/word-explanation";
import { getCommonGlossaryEntry, type CommonGlossaryEntry } from "@/src/modules/reading/domain/common-glossary";
import { speechCapabilityErrorCode } from "@/src/modules/providers/speech";

type SavedPhrase = Readonly<{ id: string; text: string; position: number }>;
type Highlight = Readonly<{ id: string; text: string; position: number }>;
type ReaderSettings = Readonly<{ fontSize: "default" | "large"; lineHeight: "default" | "relaxed"; width: "narrow" | "wide"; theme: "light" | "dim"; ttsRate: number }>;
type ReaderState = Readonly<{ stableKey: string; version: number; contentHash: string; position: number; savedPhrases: readonly SavedPhrase[]; highlights: readonly Highlight[]; note: string; saved: boolean; settings?: ReaderSettings; transferDraft?: string; transferType?: ArticleTransferType | null; status?: "in_progress" | "completed"; lastOpenedAt?: string }>;
type SelectedToken = Readonly<{ text: string; position: number; context: string; selectionType: "word" | "sentence"; tokenStart: number; tokenEnd: number }>;
type StreamPreview = Partial<Pick<WordExplanation, "partOfSpeech" | "meaning" | "contextualMeaning" | "example">>;
type TranslatorPosition = Readonly<{ left: number; top: number }>;
type WordExplanationStatus = "idle" | "loading" | "success" | "error";
type ReaderTool = "listen" | "explain" | "saved" | "settings";
type ArticleReaderProps = Readonly<{ article: ArticleReaderProjection }>;

const readerStoragePrefix = "reading-reader:v1:";
const defaultSettings: ReaderSettings = { fontSize: "default", lineHeight: "default", width: "narrow", theme: "light", ttsRate: 1 };
function initialState(article: ArticleReaderProjection): ReaderState {
  return { stableKey: article.stableKey, version: article.version, contentHash: article.contentHash, position: 0, savedPhrases: [], highlights: [], note: "", saved: false, settings: defaultSettings, transferDraft: "", transferType: null };
}
function storageKey(article: ArticleReaderProjection): string { return readerStoragePrefix + article.stableKey; }
function isReaderState(value: unknown): value is ReaderState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReaderState>;
  return typeof state.stableKey === "string" && typeof state.version === "number" && typeof state.contentHash === "string" && typeof state.position === "number" && Array.isArray(state.savedPhrases) && Array.isArray(state.highlights) && typeof state.note === "string";
}
function normalizeReaderState(value: ReaderState): ReaderState { return { ...value, saved: typeof value.saved === "boolean" ? value.saved : false, settings: value.settings ? { ...defaultSettings, ...value.settings } : defaultSettings, transferDraft: value.transferDraft ?? "", transferType: value.transferType ?? null }; }
function remoteState(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const parsed = readingStatePatchSchema.safeParse({ contentHash: state.contentHash, highlights: state.highlights, note: state.note, position: state.position, saved: state.saved, savedPhrases: state.savedPhrases, status: state.status });
  if (!parsed.success) return null;
  return { ...parsed.data, highlights: parsed.data.highlights.map((item) => ({ ...item, id: item.position + ":" + item.text })), savedPhrases: parsed.data.savedPhrases.map((item) => ({ ...item, id: item.position + ":" + item.text })) };
}
function normalizeToken(value: string): string { return value.toLocaleLowerCase().replace(/^[^\p{L}¿¡]+|[^\p{L}¿¡]+$/gu, ""); }
function clampTranslatorPosition(left: number, top: number, width: number, height: number): TranslatorPosition {
  const edge = 8;
  const toolbarBottom = document.querySelector(".article-reader__topbar")?.getBoundingClientRect().bottom;
  const topEdge = (toolbarBottom || 64) + edge;
  return {
    left: Math.min(Math.max(edge, left), Math.max(edge, window.innerWidth - width - edge)),
    top: Math.min(Math.max(topEdge, top), Math.max(topEdge, window.innerHeight - height - edge)),
  };
}

function tokenIndexOf(element: Element | null): number | null {
  if (!element) return null;
  const index = Number((element as HTMLElement).dataset.readerTokenIndex);
  return Number.isFinite(index) ? index : null;
}

function tokenWithin(element: Element, direction: "forward" | "backward"): Element | null {
  const direct = tokenIndexOf(element);
  if (direct !== null) return element;
  const tokens = element.querySelectorAll("[data-reader-token-index]");
  if (!tokens.length) return null;
  return direction === "forward" ? tokens[0] : tokens[tokens.length - 1];
}

function tokenWithinNode(node: Node, direction: "forward" | "backward"): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? tokenWithin(node as Element, direction) : null;
}

function paragraphForNode(node: Node | null | undefined): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>("[data-reader-position]") ?? null;
}

type SelectionBoundaries = Readonly<{ startNode: Node; startOffset: number; endNode: Node; endOffset: number; anchorNode: Node | null }>;

function selectionBoundaries(selection: Selection): SelectionBoundaries | null {
  const range = selection.rangeCount > 0 && typeof selection.getRangeAt === "function" ? selection.getRangeAt(0) : null;
  if (range) return { startNode: range.startContainer, startOffset: range.startOffset, endNode: range.endContainer, endOffset: range.endOffset, anchorNode: selection.anchorNode ?? null };
  if (!selection.anchorNode || !selection.focusNode) return null;
  return { startNode: selection.anchorNode, startOffset: selection.anchorOffset ?? 0, endNode: selection.focusNode, endOffset: selection.focusOffset ?? 0, anchorNode: selection.anchorNode };
}

/**
 * Reads the token index a selection boundary covers. Dragged selections often
 * end on the whitespace between two words, on the paragraph itself, or outside
 * the paragraph entirely (the pointer overshoots into the margins or the gap
 * between paragraphs), so the boundary resolves to the nearest token in the
 * direction the selection grows instead of dropping the whole gesture.
 */
function boundaryTokenIndex(paragraph: HTMLElement, node: Node, offset: number, direction: "forward" | "backward"): number | null {
  if (!paragraph.contains(node)) {
    const relation = paragraph.compareDocumentPosition(node);
    if (relation & Node.DOCUMENT_POSITION_PRECEDING) return tokenIndexOf(tokenWithin(paragraph, "forward"));
    if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return tokenIndexOf(tokenWithin(paragraph, "backward"));
    return null;
  }
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) return null;
  const direct = tokenIndexOf(element.closest("[data-reader-token-index]"));
  if (direct !== null) return direct;
  let cursor: Node | null = node;
  if (node === paragraph) {
    const child = direction === "forward" ? offset : offset - 1;
    cursor = paragraph.childNodes[Math.min(Math.max(child, 0), Math.max(paragraph.childNodes.length - 1, 0))] ?? null;
  }
  while (cursor && cursor !== paragraph) {
    const index = tokenIndexOf(tokenWithinNode(cursor, direction));
    if (index !== null) return index;
    const sibling: Node | null = direction === "forward" ? cursor.nextSibling : cursor.previousSibling;
    if (sibling) { cursor = sibling; continue; }
    cursor = cursor.parentNode;
  }
  // The boundary sits at the edge of the paragraph: fall back to the nearest token.
  return tokenIndexOf(tokenWithin(paragraph, direction === "forward" ? "backward" : "forward"));
}

/** Range boundaries keep the drag direction irrelevant: a range start always precedes its end. */
function selectedTokenRange(paragraph: HTMLElement, selection: Selection): Readonly<{ start: number; end: number }> | null {
  const boundaries = selectionBoundaries(selection);
  if (!boundaries) return null;
  const start = boundaryTokenIndex(paragraph, boundaries.startNode, boundaries.startOffset, "forward");
  const end = boundaryTokenIndex(paragraph, boundaries.endNode, boundaries.endOffset, "backward");
  if (start === null || end === null) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

type ReaderParagraphProps = Readonly<{
  segment: ArticleReaderSegment;
  highlighted: boolean;
  listenTarget: boolean;
  selectionStart: number;
  selectionEnd: number;
  tabbable: boolean;
  onSelectToken: (text: string, position: number, context: string, tokenIndex: number, trigger: HTMLElement) => void;
}>;

/**
 * One article paragraph. Rendering is memoized per paragraph so that selecting a
 * sentence, streaming a translation or moving the reading position never rebuilds
 * every word token in a 1,000+ word article.
 *
 * Word tokens stay out of the tab order while the reader is used with a pointer:
 * Chrome focuses a focusable token on mousedown, and that focus cancels the
 * browser's drag selection whenever the press lands on a word boundary, so
 * sentences could not be dragged from the gap between words.
 */
const ReaderParagraph = memo(function ReaderParagraph({ segment, highlighted, listenTarget, selectionStart, selectionEnd, tabbable, onSelectToken }: ReaderParagraphProps) {
  const words = useMemo(() => segment.text.split(/(\s+)/u), [segment.text]);
  const className = [highlighted ? "is-highlighted" : "", listenTarget ? "is-listen-target" : ""].filter(Boolean).join(" ");
  return <p
    id={"segment-" + segment.position}
    className={className}
    aria-current={listenTarget ? "true" : undefined}
    data-reader-position={segment.position}
  >
    {words.map((word, index) => /\s+/u.test(word)
      ? word
      : <span
        key={segment.position + "-word-" + index}
        className={["reader-token", selectionStart < 0 ? "" : index >= selectionStart && index <= selectionEnd ? "is-translation-selection" : ""].filter(Boolean).join(" ")}
        data-reader-token-index={index}
        role="button"
        tabIndex={tabbable ? 0 : undefined}
        onClick={(event) => onSelectToken(word, segment.position, segment.text, index, event.currentTarget)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectToken(word, segment.position, segment.text, index, event.currentTarget); } }}
      >{word}</span>)}
  </p>;
});

function ListenIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 10v4h4l5 4V6l-5 4H5zm12-1.5a5 5 0 0 1 0 7" /></svg>;
}

function BookmarkIcon({ filled }: Readonly<{ filled: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 4.5h11v15l-5.5-3.2-5.5 3.2z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function SettingsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h10m4 0h2M4 17h2m4 0h10M14 4v6M6 14v6" /></svg>;
}

function PinIcon({ pinned }: Readonly<{ pinned: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M8 4h8l-1.5 5 3 3H13v7l-1 1-1-1v-7H6.5l3-3z" fill={pinned ? "currentColor" : "none"} /></svg>;
}

export function ArticleReader({ article }: ArticleReaderProps) {
  const [state, setState] = useState<ReaderState>(() => initialState(article));
  const [hydrated, setHydrated] = useState(false);
  const [activePosition, setActivePosition] = useState(0);
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);
  const [wordExplanation, setWordExplanation] = useState<WordExplanation | null>(null);
  const [streamPreview, setStreamPreview] = useState<StreamPreview>({});
  const [commonEntry, setCommonEntry] = useState<CommonGlossaryEntry | null>(null);
  const [wordExplanationStatus, setWordExplanationStatus] = useState<WordExplanationStatus>("idle");
  const [wordExplanationError, setWordExplanationError] = useState("");
  const [activeTool, setActiveTool] = useState<ReaderTool>("explain");
  const [toolsOpen, setToolsOpenState] = useState(false);
  const [toolsPinned, setToolsPinned] = useState(false);
  const [translatorPosition, setTranslatorPosition] = useState<TranslatorPosition | null>(null);
  const [draggingTranslator, setDraggingTranslator] = useState(false);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const [speakingPosition, setSpeakingPosition] = useState<number | "full" | "voice-preview" | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [speechStarted, setSpeechStarted] = useState(false);
  const speechGenerationRef = useRef(0);
  const [ttsError, setTtsError] = useState(false);
  const [ttsErrorMessage, setTtsErrorMessage] = useState("");
  const [online, setOnline] = useState(true);
  const [serverSync, setServerSync] = useState<"pending" | "available" | "unauthenticated" | "unavailable" | "conflict">("pending");
  const [status, setStatus] = useState("");
  const [activeTransfer, setActiveTransfer] = useState<ArticleTransferType | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const restoredPositionRef = useRef<number | null>(null);
  const previousOnlineRef = useRef(online);
  const contentRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  const toolsPinRef = useRef<HTMLButtonElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const selectionHandledRef = useRef(false);
  const translatorDragRef = useRef<Readonly<{ pointerId: number; startX: number; startY: number; originLeft: number; originTop: number; width: number; height: number }> | null>(null);
  const explanationRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const explanationGenerationRef = useRef(0);
  const pendingPreviewRef = useRef<StreamPreview | null>(null);
  const previewFrameRef = useRef(0);
  const cancelStreamPreview = useCallback(() => {
    if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = 0;
    pendingPreviewRef.current = null;
  }, []);
  // Streamed deltas arrive faster than the display refreshes; publishing at most
  // one preview per animation frame keeps the translation panel responsive.
  const scheduleStreamPreview = useCallback((next: StreamPreview) => {
    pendingPreviewRef.current = { ...pendingPreviewRef.current, ...next };
    if (previewFrameRef.current) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = 0;
      const pending = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (pending) setStreamPreview((previous) => ({ ...previous, ...pending }));
    });
  }, []);
  const flushStreamPreview = useCallback(() => {
    if (previewFrameRef.current) cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = 0;
    const pending = pendingPreviewRef.current;
    pendingPreviewRef.current = null;
    if (pending) setStreamPreview((previous) => ({ ...previous, ...pending }));
  }, []);
  const tts = useMemo(() => createReadAloud(), []);
  const settings = state.settings ?? defaultSettings;
  const closeTools = useCallback(() => {
    explanationRequestRef.current?.controller.abort();
    cancelStreamPreview();
    setWordExplanationStatus("idle");
    setSelectedToken(null);
    setCommonEntry(null);
    setWordExplanation(null);
    setStreamPreview({});
    setToolsPinned(false);
    setTranslatorPosition(null);
    setDraggingTranslator(false);
    translatorDragRef.current = null;
    setToolsOpenState(false);
  }, [cancelStreamPreview]);
  const toggleTool = useCallback((tool: ReaderTool, trigger: HTMLButtonElement) => {
    if (toolsOpen && activeTool === tool) {
      closeTools();
      return;
    }
    previouslyFocusedRef.current = trigger;
    setActiveTool(tool);
    setToolsPinned(false);
    setTranslatorPosition(null);
    setToolsOpenState(true);
  }, [activeTool, closeTools, toolsOpen]);

  useEffect(() => () => { speechGenerationRef.current += 1; tts.stop(); }, [tts]);
  useEffect(() => () => explanationRequestRef.current?.controller.abort(), []);
  useEffect(() => () => cancelStreamPreview(), [cancelStreamPreview]);
  useEffect(() => {
    // Word tokens only become tab stops once the reader is driven from the keyboard.
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Tab") setKeyboardNavigation(true); };
    const onPointerUp = () => setKeyboardNavigation((current) => current ? false : current);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerup", onPointerUp);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerup", onPointerUp);
    };
  }, []);
  useEffect(() => {
    const recoveredFromOffline = !previousOnlineRef.current && online;
    previousOnlineRef.current = online;
    if (["available", "unauthenticated", "conflict"].includes(serverSync)) return;
    if (serverSync === "unavailable" && !recoveredFromOffline) return;
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(storageKey(article));
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (isReaderState(saved) && saved.stableKey === article.stableKey && saved.version === article.version && saved.contentHash === article.contentHash) queueMicrotask(() => setState(normalizeReaderState({ ...saved, position: Math.min(saved.position, Math.max(article.segments.length - 1, 0)) })));
        else if (isReaderState(saved) && saved.version !== article.version) queueMicrotask(() => setStatus("文章版本已更新，旧标注仍保留在原版本；请从第一段或你熟悉的位置重新开始。"));
      }
    } catch { queueMicrotask(() => setStatus("暂时无法读取上次的阅读位置，本次阅读仍可继续。")); }
    queueMicrotask(() => { setOnline(navigator.onLine); setHydrated(true); });
    if (!navigator.onLine) return () => { cancelled = true; };
    void fetch("/api/v1/read/articles/" + encodeURIComponent(article.id) + "/state", { credentials: "same-origin" }).then(async (response) => {
      if (response.status === 401) { if (!cancelled) setServerSync("unauthenticated"); return; }
      if (!response.ok) throw new Error("state-unavailable");
      const payload = (await response.json()) as { data?: { state?: unknown } };
      const remote = remoteState(payload.data?.state);
      if (!cancelled && remote) {
        if (remote.contentHash !== article.contentHash) { setStatus("服务端保留了旧文章版本的阅读标注；当前版本从本地位置继续，旧标注不会被覆盖。"); setServerSync("conflict"); return; }
        setState((previous) => ({ ...previous, contentHash: remote.contentHash, highlights: remote.highlights, note: remote.note, position: Math.min(remote.position, Math.max(article.segments.length - 1, 0)), saved: remote.saved, savedPhrases: remote.savedPhrases }));
      }
      if (!cancelled) setServerSync("available");
    }).catch(() => { if (!cancelled) setServerSync("unavailable"); });
    return () => { cancelled = true; };
  }, [article, online, serverSync]);
  useEffect(() => { if (!hydrated) return; try { window.localStorage.setItem(storageKey(article), JSON.stringify({ ...state, status: state.position >= article.segments.length - 1 ? "completed" : "in_progress", lastOpenedAt: new Date().toISOString() })); } catch { /* local state remains usable */ } }, [article, hydrated, state]);
  useEffect(() => {
    const key = storageKey(article);
    const applySavedItems = (raw: string | null) => {
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isReaderState(parsed) || parsed.stableKey !== article.stableKey || parsed.version !== article.version || parsed.contentHash !== article.contentHash) return;
        setState((previous) => ({ ...previous, savedPhrases: parsed.savedPhrases, highlights: parsed.highlights }));
      } catch {
        // A malformed cross-tab update must not interrupt the active reader.
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) applySavedItems(event.newValue);
    };
    const onSavedItemRemoved = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const item = detail as { stableKey?: unknown; version?: unknown };
      if (item.stableKey !== article.stableKey || item.version !== article.version) return;
      applySavedItems(window.localStorage.getItem(key));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("sueno:reading-saved-item-removed", onSavedItemRemoved);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("sueno:reading-saved-item-removed", onSavedItemRemoved);
    };
  }, [article]);
  useEffect(() => {
    if (!hydrated || !online || serverSync !== "available") return;
    const controller = new AbortController();
    const payload = readingStatePatchSchema.safeParse({ contentHash: article.contentHash, highlights: state.highlights, note: state.note, position: state.position, saved: state.saved, savedPhrases: state.savedPhrases, status: state.position >= article.segments.length - 1 ? "completed" : "in_progress" });
    if (!payload.success) return () => controller.abort();
    void fetch("/api/v1/read/articles/" + encodeURIComponent(article.id) + "/state", { body: JSON.stringify(payload.data), credentials: "same-origin", headers: { "content-type": "application/json" }, method: "PATCH", signal: controller.signal }).then((response) => { if (response.status === 409) { setServerSync("conflict"); setStatus("文章版本已更新，当前标注保留在本机；重新打开最新版本后可以重新保存。"); } else if (response.status === 401) setServerSync("unauthenticated"); else if (!response.ok) setServerSync("unavailable"); }).catch(() => { if (!controller.signal.aborted) setServerSync("unavailable"); });
    return () => controller.abort();
  }, [article, hydrated, online, serverSync, state]);
  useEffect(() => { const onOnline = () => setOnline(true); const onOffline = () => setOnline(false); window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); }; }, []);
  const restoreFocus = useCallback(() => {
    const target = previouslyFocusedRef.current;
    previouslyFocusedRef.current = null;
    // Word tokens are only focusable while the reader is driven from the keyboard.
    target?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => { if (!toolsOpen) { explanationRequestRef.current?.controller.abort(); restoreFocus(); return; } const pin = toolsPinRef.current; if (activeTool === "explain" && pin && window.getComputedStyle(pin).display !== "none") pin.focus(); else toolsRef.current?.focus(); }, [activeTool, restoreFocus, toolsOpen]);
  useEffect(() => {
    if (!toolsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeTools(); }
    };
    document.addEventListener("keydown", onKeyDown); return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeTools, toolsOpen]);
  useEffect(() => {
    if (!toolsOpen || toolsPinned) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (toolsRef.current?.contains(event.target) || toolbarRef.current?.contains(event.target)) return;
      previouslyFocusedRef.current = null;
      closeTools();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [closeTools, toolsOpen, toolsPinned]);
  useEffect(() => {
    if (!toolsPinned) return;
    const unpinBelowDesktop = () => { if (window.innerWidth < 1200) { setToolsPinned(false); setTranslatorPosition(null); } };
    window.addEventListener("resize", unpinBelowDesktop);
    return () => window.removeEventListener("resize", unpinBelowDesktop);
  }, [toolsPinned]);
  useEffect(() => {
    if (!translatorPosition || toolsPinned) return;
    const keepTranslatorInViewport = () => {
      const rect = toolsRef.current?.getBoundingClientRect();
      if (!rect) return;
      setTranslatorPosition((current) => current ? clampTranslatorPosition(current.left, current.top, rect.width, rect.height) : null);
    };
    window.addEventListener("resize", keepTranslatorInViewport);
    return () => window.removeEventListener("resize", keepTranslatorInViewport);
  }, [toolsPinned, translatorPosition]);
  useEffect(() => {
    if (!draggingTranslator) return;
    const onPointerMove = (event: PointerEvent) => {
      const drag = translatorDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      setTranslatorPosition(clampTranslatorPosition(drag.originLeft + event.clientX - drag.startX, drag.originTop + event.clientY - drag.startY, drag.width, drag.height));
    };
    const stopDragging = (event: PointerEvent) => {
      if (translatorDragRef.current && event.pointerId !== translatorDragRef.current.pointerId) return;
      translatorDragRef.current = null;
      setDraggingTranslator(false);
    };
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stopDragging);
    document.addEventListener("pointercancel", stopDragging);
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stopDragging);
      document.removeEventListener("pointercancel", stopDragging);
    };
  }, [draggingTranslator]);
  useEffect(() => { restoredPositionRef.current = null; }, [article]);
  useEffect(() => {
    if (!hydrated || restoredPositionRef.current !== null) return;
    const anchor = /^#segment-(\d+)$/u.exec(window.location.hash);
    const anchorPosition = anchor ? Number(anchor[1]) : null;
    const validAnchor = anchorPosition !== null && article.segments.some((segment) => segment.position === anchorPosition);
    if (!validAnchor && state.position <= 0) return;
    const position = validAnchor ? anchorPosition : state.position;
    const frame = requestAnimationFrame(() => {
      restoredPositionRef.current = position;
      document.querySelector<HTMLElement>(`[data-reader-position="${position}"]`)?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [article.segments, hydrated, state.position]);
  const selectionVisible = toolsOpen && activeTool === "explain";
  const activePositionRef = useRef(0);
  const updatePosition = useCallback(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-reader-position]")];
    const anchor = window.scrollY + window.innerHeight * 0.32;
    const current = nodes.reduce((candidate, node) => node.offsetTop <= anchor ? Number(node.dataset.readerPosition) : candidate, 0);
    if (activePositionRef.current === current) return;
    activePositionRef.current = current;
    setActivePosition(current);
    setState((previous) => previous.position === current ? previous : { ...previous, position: current });
  }, []);
  useEffect(() => { let frame = 0; const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updatePosition); }; window.addEventListener("scroll", onScroll, { passive: true }); return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); }; }, [updatePosition]);
  const stopSpeech = useCallback(() => {
    speechGenerationRef.current += 1;
    tts.stop();
    setSpeakingPosition(null);
    setSpeakingText(null);
    setSpeechStarted(false);
  }, [tts]);
  const speak = useCallback(async (text: string, position: number | "full" | "voice-preview") => {
    if (!tts.isSupported) { setTtsError(true); setTtsErrorMessage("当前浏览器不支持音频播放，正文阅读不受影响。"); return; }
    const generation = ++speechGenerationRef.current;
    setSpeakingPosition(position);
    setSpeakingText(text);
    setSpeechStarted(false);
    setTtsError(false);
    setTtsErrorMessage("");
    try {
      await tts.speak(text, { languageTag: article.locale, rate: settings.ttsRate, onStart: () => { if (speechGenerationRef.current === generation) setSpeechStarted(true); } });
    } catch (error) {
      if (speechGenerationRef.current !== generation) return;
      if (speechCapabilityErrorCode(error, "tts-failed") === "tts-cancelled") return;
      setTtsErrorMessage(readAloudErrorMessage(error));
      setTtsError(true);
    } finally {
      if (speechGenerationRef.current === generation) { setSpeakingPosition(null); setSpeakingText(null); setSpeechStarted(false); }
    }
  }, [article.locale, settings.ttsRate, tts]);
  const transferTask = activeTransfer ? articleTransferTask(article, activeTransfer) : null;
  const recommendedTransfer = recommendedArticleTransferType(article.oralTransferType);
  const fullText = useMemo(() => article.segments.map((segment) => segment.text).join(" "), [article.segments]);
  const currentSegment = article.segments[activePosition] ?? article.segments[state.position];
  const progressPercent = article.segments.length <= 1 ? 100 : Math.round((state.position / (article.segments.length - 1)) * 100);
  const readerClass = "article-reader article-reader--" + settings.fontSize + " article-reader--" + settings.lineHeight + " article-reader--" + settings.width + " article-reader--" + settings.theme + (toolsOpen ? " article-reader--tools-open" : "") + (toolsPinned ? " article-reader--tools-pinned" : "");
  const requestWordExplanation = useCallback((token: SelectedToken) => {
    explanationRequestRef.current?.controller.abort();
    cancelStreamPreview();
    const selectedText = token.selectionType === "sentence" ? token.text.trim() : normalizeToken(token.text);
    if (!selectedText) {
      setWordExplanation(null);
      setWordExplanationError("请选择一个词语。");
      setWordExplanationStatus("error");
      return;
    }
    const generation = explanationGenerationRef.current + 1;
    explanationGenerationRef.current = generation;
    const controller = new AbortController();
    explanationRequestRef.current = { generation, controller };
    setWordExplanation(null);
    setWordExplanationError("");
    setWordExplanationStatus("loading");
    void fetch("/api/v1/read/word-explanation", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ word: selectedText, context: token.context, locale: article.locale, selectionType: token.selectionType }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(payload?.error?.message || "解释暂时无法生成，请稍后重试。");
      }
      if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
        const payload = (await response.json()) as { data?: WordExplanation; error?: { message?: string } };
        if (!payload.data) throw new Error(payload.error?.message || "解释暂时无法生成，请稍后重试。");
        if (explanationRequestRef.current?.generation !== generation) return;
        setWordExplanation(payload.data);
        setWordExplanationStatus("success");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let generated = "";
      const decodePartialJsonString = (raw: string): string | null => {
        let candidate = raw;
        const trailingBackslashes = candidate.match(/\\+$/u)?.[0].length ?? 0;
        if (trailingBackslashes % 2 === 1) candidate = candidate.slice(0, -1);
        candidate = candidate.replace(/\\u[0-9a-fA-F]{0,3}$/u, "");
        try { return JSON.parse('"' + candidate + '"') as string; } catch { return null; }
      };
      const updatePreview = (text: string) => {
        const fields = ["partOfSpeech", "meaning", "contextualMeaning", "example"] as const;
        const next: Partial<Record<(typeof fields)[number], string>> = {};
        for (const field of fields) {
          const keyStart = text.indexOf('"' + field + '"');
          if (keyStart < 0) continue;
          const valueStart = text.indexOf('"', text.indexOf(":", keyStart) + 1);
          if (valueStart < 0) continue;
          let escaped = false;
          let valueEnd = text.length;
          for (let index = valueStart + 1; index < text.length; index += 1) {
            const character = text[index];
            if (escaped) { escaped = false; continue; }
            if (character === "\\") { escaped = true; continue; }
            if (character === '"') { valueEnd = index; break; }
          }
          const value = decodePartialJsonString(text.slice(valueStart + 1, valueEnd));
          if (value) next[field] = value;
        }
        if (Object.keys(next).length) scheduleStreamPreview(next);
      };
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as { type?: string; text?: string; explanation?: WordExplanation; error?: { message?: string } };
        if (event.type === "delta" && event.text) { generated += event.text; updatePreview(generated); }
        if (event.type === "done" && event.explanation) { flushStreamPreview(); setWordExplanation(event.explanation); setWordExplanationStatus("success"); }
        if (event.error?.message) throw new Error(event.error.message);
      };
      while (true) {
        const result = await reader.read();
        buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
        const lines = buffer.split(/\r?\n/u);
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (result.done) break;
      }
      if (buffer.trim()) consume(buffer);
      if (explanationRequestRef.current?.generation !== generation) return;
    }).catch((error: unknown) => {
      if (controller.signal.aborted || explanationRequestRef.current?.generation !== generation) return;
      setWordExplanationStatus("error");
      setWordExplanationError(error instanceof Error ? error.message : "解释暂时无法生成，请稍后重试。");
    });
  }, [article.locale, cancelStreamPreview, flushStreamPreview, scheduleStreamPreview]);
  const selectToken = useCallback((text: string, position: number, context: string, tokenIndex: number, trigger: HTMLElement) => {
    if (selectionHandledRef.current) return;
    const token = { text, position, context, selectionType: "word" as const, tokenStart: tokenIndex, tokenEnd: tokenIndex };
    const entry = getCommonGlossaryEntry(normalizeToken(text));
    setCommonEntry(entry);
    setSelectedToken(token);
    setActiveTool("explain");
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : trigger;
    setToolsOpenState(true);
    cancelStreamPreview();
    setStreamPreview({});
    if (entry) {
      setWordExplanationStatus("success");
    } else {
      requestWordExplanation(token);
    }
  }, [cancelStreamPreview, requestWordExplanation]);
  const handleTextSelection = useCallback((event: MouseEvent<HTMLDivElement>) => {
    // Selecting text inside the translator panel must not start a new sentence lookup.
    if (event.target instanceof Node && toolsRef.current?.contains(event.target)) return;
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    if (!selection || selectedText.split(/\s+/u).filter(Boolean).length < 2) return;
    const boundaries = selectionBoundaries(selection);
    if (!boundaries) return;
    // The dragged paragraph is the one the gesture started in; releases that land
    // in the margin or between paragraphs still belong to it.
    const paragraph = paragraphForNode(boundaries.anchorNode) ?? paragraphForNode(boundaries.startNode) ?? paragraphForNode(boundaries.endNode);
    if (!paragraph) return;
    const position = Number(paragraph.dataset.readerPosition);
    if (!Number.isFinite(position)) return;
    const range = selectedTokenRange(paragraph, selection);
    if (!range) return;
    selectionHandledRef.current = true;
    window.setTimeout(() => { selectionHandledRef.current = false; }, 0);
    selection.removeAllRanges();
    explanationRequestRef.current?.controller.abort();
    cancelStreamPreview();
    const context = article.segments.find((segment) => segment.position === position)?.text ?? paragraph.textContent ?? "";
    const token = { text: selectedText, position, context, selectionType: "sentence" as const, tokenStart: range.start, tokenEnd: range.end };
    setCommonEntry(null);
    setSelectedToken(token);
    setWordExplanation(null);
    setStreamPreview({});
    setWordExplanationError("");
    setWordExplanationStatus("idle");
    setActiveTool("explain");
    previouslyFocusedRef.current = paragraph;
    setToolsOpenState(true);
    requestWordExplanation(token);
  }, [article.segments, cancelStreamPreview, requestWordExplanation]);
  const startTranslatorDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || toolsPinned || activeTool !== "explain" || window.innerWidth < 1200) return;
    if (event.target instanceof Element && event.target.closest("button")) return;
    const rect = toolsRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    translatorDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originLeft: rect.left, originTop: rect.top, width: rect.width, height: rect.height };
    setDraggingTranslator(true);
  }, [activeTool, toolsPinned]);
  const toggleSavedPhrase = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.savedPhrases.some((item) => item.id === id); setState((previous) => ({ ...previous, savedPhrases: exists ? previous.savedPhrases.filter((item) => item.id !== id) : [...previous.savedPhrases, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已从本篇 Words 移除。" : "已保存到本篇 Words。"); };
  const toggleHighlight = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.highlights.some((item) => item.id === id); setState((previous) => ({ ...previous, highlights: exists ? previous.highlights.filter((item) => item.id !== id) : [...previous.highlights, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已取消高亮。" : "已标记高亮。"); };
  const updateSetting = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => setState((previous) => ({ ...previous, settings: { ...(previous.settings ?? defaultSettings), [key]: value } }));
  const renderTransferPanel = () => <section className="article-reader__transfer" data-testid="article-transfer" aria-labelledby="article-transfer-title">
    <h2 id="article-transfer-title">选择口语方向</h2>
    <div className="article-reader__transfer-options" role="group" aria-label="口语迁移方向">
      {articleTransferTypes.map((type) => {
        const task = articleTransferTask(article, type);
        return <button className="article-reader__transfer-option" type="button" key={type} aria-pressed={activeTransfer === type} onClick={() => { setActiveTransfer(type); setState((previous) => ({ ...previous, transferType: type })); }}><strong>{task.label}</strong>{recommendedTransfer === type ? <small>推荐</small> : null}</button>;
      })}
    </div>
    {transferTask ? <div className="article-reader__transfer-panel"><p>{transferTask.prompt}</p><textarea value={state.transferDraft ?? ""} onChange={(event) => setState((previous) => ({ ...previous, transferDraft: event.target.value.slice(0, 2_000) }))} placeholder="先写要点（可选）" aria-label="口语迁移草稿" /><div className="article-reader__transfer-actions"><Link className="primary-link" href={`/learn/practice?article=${encodeURIComponent(article.id)}&transfer=${transferTask.type}`}>进入口语复核</Link><button className="secondary-action" type="button" onClick={() => setStatus("草稿已保存；尚未产生口语证据。")}>保存草稿</button><button className="text-link" type="button" onClick={() => { setActiveTransfer(null); setState((previous) => ({ ...previous, transferDraft: "", transferType: null })); setStatus("已跳过口语迁移；阅读不会产生口语证据。"); }}>跳过</button></div></div> : <p className="article-reader__tool-note">只有进入口语复核才会评估口语。</p>}
  </section>;
  const renderToolPanel = () => {
    if (activeTool === "listen") {
      const paragraphNumber = (currentSegment?.position ?? 0) + 1;
      const preview = currentSegment ? currentSegment.text.slice(0, 56) + (currentSegment.text.length > 56 ? "…" : "") : "";
      return <><div className="article-reader__listen-target"><strong>当前：第 {paragraphNumber} 段</strong><p>{preview}</p></div><div className="article-reader__tool-actions"><button className="secondary-action" type="button" onClick={() => { if (currentSegment) void speak(currentSegment.text, currentSegment.position); }} disabled={speakingPosition !== null}>{speakingPosition === currentSegment?.position ? `正在朗读第 ${paragraphNumber} 段` : `朗读第 ${paragraphNumber} 段`}</button><button className="secondary-action" type="button" onClick={() => void speak(fullText, "full")} disabled={speakingPosition !== null}>{speakingPosition === "full" ? "正在朗读全文" : "朗读全文"}</button></div>{speakingPosition !== null ? <button className="text-link" type="button" onClick={stopSpeech}>停止朗读</button> : null}{ttsError ? <p className="article-reader__tool-error" role="status">{ttsErrorMessage || "暂时无法朗读，正文阅读不受影响。"}</p> : null}</>;
    }
    if (activeTool === "explain") {
      if (!selectedToken) return <div className="article-reader__tool-empty"><p>点击正文中的词语查看语境解释。</p><p>拖选两个以上词语可以解析整句。</p></div>;
      const id = selectedToken.position + ":" + selectedToken.text;
      const phraseSaved = state.savedPhrases.some((item) => item.id === id);
      const highlighted = state.highlights.some((item) => item.id === id);
      const isSentence = selectedToken.selectionType === "sentence";
      const selectedSpeechActive = speakingPosition === selectedToken.position && speakingText === selectedToken.text;
      const localMeaning = commonEntry?.meanings.map((item) => item.meaning).join("；");
      const localUsage = commonEntry?.meanings.map((item) => item.usage).join("；");
      const localExample = commonEntry?.examples.join(" / ");
      const meaning = wordExplanation?.meaning ?? streamPreview.meaning ?? (isSentence ? undefined : localMeaning);
      const partOfSpeech = wordExplanation?.partOfSpeech ?? streamPreview.partOfSpeech ?? (isSentence ? undefined : commonEntry?.partOfSpeech);
      const example = wordExplanation?.example ?? streamPreview.example ?? (isSentence ? undefined : localExample);
      const contextualMeaning = wordExplanation?.contextualMeaning ?? streamPreview.contextualMeaning ?? (isSentence ? undefined : localUsage);
      return <>
        <div className="article-reader__selected-word"><span>{selectedToken.text}</span><button type="button" aria-label={"朗读 " + selectedToken.text} aria-pressed={selectedSpeechActive} title={selectedSpeechActive ? "停止朗读" : "朗读"} onClick={() => { if (selectedSpeechActive) stopSpeech(); else void speak(selectedToken.text, selectedToken.position); }}><svg aria-hidden="true" viewBox="0 0 24 24"><path d={selectedSpeechActive ? "M7 7h10v10H7z" : "M5 10v4h4l5 4V6l-5 4H5zm12-1.5a5 5 0 0 1 0 7"} /></svg></button></div>
        {selectedSpeechActive ? <p className="article-reader__tool-note" role="status">{speechStarted ? "正在朗读，再点一次停止。" : "正在准备语音，再点一次取消。"}</p> : null}
        {ttsError ? <p className="article-reader__tool-error" role="status">{ttsErrorMessage || "暂时无法朗读，正文阅读不受影响。"}</p> : null}
        <div className="article-reader__explanation-fields">
          {isSentence ? <>
            <div><p className="article-reader__tool-kicker">中文翻译</p><p>{meaning ?? (wordExplanationStatus === "loading" ? "正在生成翻译……" : "点击下方按钮解析")}</p></div>
            <div><p className="article-reader__tool-kicker">句子解析</p><p><strong>{contextualMeaning ?? (wordExplanationStatus === "loading" ? "正在生成解析……" : "点击下方按钮解析")}</strong></p></div>
            {wordExplanation?.example ? <div><p className="article-reader__tool-kicker">参考表达</p><p>{wordExplanation.example}</p></div> : null}
          </> : <>
            <div><p className="article-reader__tool-kicker">词性</p><p>{partOfSpeech ?? "暂未识别"}</p></div>
            <div><p className="article-reader__tool-kicker">基本释义</p><p>{meaning ?? (wordExplanationStatus === "loading" ? "正在生成解释……" : "暂未生成")}</p></div>
            <div><p className="article-reader__tool-kicker">本句语境义</p><p><strong>{contextualMeaning ?? (wordExplanationStatus === "loading" ? "正在生成语境义……" : "暂未生成")}</strong></p></div>
            {example ? <div><p className="article-reader__tool-kicker">例句</p><p>{example}</p></div> : null}
            {commonEntry?.collocations.length ? <div><p className="article-reader__tool-kicker">常见搭配</p><p>{commonEntry.collocations.join("、")}</p></div> : null}
            {commonEntry?.cefr ? <div><p className="article-reader__tool-kicker">难度</p><p>{commonEntry.cefr}</p></div> : null}
          </>}
        </div>
        {wordExplanationStatus === "loading" ? <p className="article-reader__tool-note" role="status" aria-live="polite">正在生成解释……</p> : null}
        {wordExplanationStatus === "error" ? <div role="alert"><p className="article-reader__tool-note">{wordExplanationError || "解释暂时无法生成，请稍后重试。"}</p><button className="secondary-action" type="button" onClick={() => requestWordExplanation(selectedToken)}>重试解释</button></div> : null}
        <div className="article-reader__tool-actions"><button className="secondary-action" type="button" aria-pressed={phraseSaved} onClick={toggleSavedPhrase}>{phraseSaved ? "已保存" : "保存词语"}</button><button className="secondary-action" type="button" aria-pressed={highlighted} onClick={toggleHighlight}>{highlighted ? "取消高亮" : "高亮"}</button></div>
      </>;
    }
    if (activeTool === "saved") {
      const items = [...state.savedPhrases, ...state.highlights.map((item) => ({ ...item, id: "highlight-" + item.id, text: item.text + "（高亮）" }))];
      return <><button className="article-reader__save-article" type="button" aria-pressed={state.saved} onClick={() => { setState((previous) => ({ ...previous, saved: !previous.saved })); setStatus(state.saved ? "已取消收藏本文。" : "已收藏本文。"); }}>{state.saved ? "已收藏本文" : "收藏本文"}</button>{items.length ? <ul className="article-reader__saved-list">{items.map((item) => <li key={item.id}><span>{item.text}</span><button type="button" onClick={() => document.querySelector<HTMLElement>("[data-reader-position=\"" + item.position + "\"]")?.scrollIntoView({ block: "center" })}>跳转</button></li>)}</ul> : <p className="article-reader__tool-note">尚未保存词语或高亮。</p>}<Link className="text-link article-reader__saved-library-link" href="/read/saved-items">打开已保存词句书架 <span aria-hidden="true">→</span></Link><label className="article-reader__note-field"><span>个人笔记</span><textarea value={state.note} onChange={(event) => setState((previous) => ({ ...previous, note: event.target.value.slice(0, 2_000) }))} placeholder="可以写中文或西语……" aria-label="文章个人笔记" /></label><button className="secondary-action" type="button" onClick={() => setStatus("笔记已保存在阅读状态中。")}>保存笔记</button></>;
    }
    return <><section className="article-reader__voice-settings" aria-labelledby="read-aloud-voice-title"><div className="article-reader__voice-settings-heading"><div><p className="article-reader__tool-kicker">朗读声音</p><h3 id="read-aloud-voice-title">Serene Woman 女声</h3></div><span className="article-reader__voice-settings-current">Serene Woman</span></div><button type="button" className="article-reader__voice-preview" aria-label="试听 Serene Woman 女声" disabled={speakingPosition !== null} onClick={() => void speak("Hola, esta es una muestra de la voz seleccionada.", "voice-preview")}>试听</button></section><label className="article-reader__setting"><span>字号</span><select aria-label="字号" value={settings.fontSize} onChange={(event) => updateSetting("fontSize", event.target.value as ReaderSettings["fontSize"])}><option value="default">标准</option><option value="large">大字</option></select></label><label className="article-reader__setting"><span>行距</span><select aria-label="行距" value={settings.lineHeight} onChange={(event) => updateSetting("lineHeight", event.target.value as ReaderSettings["lineHeight"])}><option value="default">舒适</option><option value="relaxed">宽松</option></select></label><label className="article-reader__setting"><span>正文宽度</span><select aria-label="正文宽度" value={settings.width} onChange={(event) => updateSetting("width", event.target.value as ReaderSettings["width"])}><option value="narrow">专注</option><option value="wide">宽屏</option></select></label><label className="article-reader__setting"><span>背景</span><select aria-label="阅读背景" value={settings.theme} onChange={(event) => updateSetting("theme", event.target.value as ReaderSettings["theme"])}><option value="light">浅色</option><option value="dim">柔和</option></select></label><label className="article-reader__setting"><span>朗读速度</span><select aria-label="TTS 速度" value={settings.ttsRate} onChange={(event) => updateSetting("ttsRate", Number(event.target.value))}><option value="0.7">慢速</option><option value="0.88">较慢</option><option value="1">标准</option><option value="1.05">稍快</option></select></label></>;
  };
  const toolLabels: Readonly<Record<ReaderTool, string>> = { listen: "朗读", explain: "解释", saved: "收藏", settings: "设置" };
  const toolbarTools = ["listen", "saved", "settings"] as const;
  const toolIcons: Readonly<Record<(typeof toolbarTools)[number], React.ReactNode>> = {
    listen: <ListenIcon />,
    saved: <BookmarkIcon filled={state.saved} />,
    settings: <SettingsIcon />,
  };
  return <div className={readerClass} data-online={online} onMouseUp={handleTextSelection}>
    <header className="article-reader__topbar">
      <div className="article-reader__topbar-left"><Link className="text-link article-reader__back" href="/read"><span aria-hidden="true">←</span> 返回</Link></div>
      <h1 className="article-reader__topbar-title" title={article.title}>{article.title}</h1>
      <div className="article-reader__topbar-actions" ref={toolbarRef} aria-label="阅读工具栏">{toolbarTools.map((tool) => <button className={toolsOpen && activeTool === tool ? "is-active" : ""} type="button" key={tool} aria-label={toolLabels[tool]} aria-expanded={toolsOpen && activeTool === tool} aria-controls="article-reader-tool-panel" onClick={(event) => toggleTool(tool, event.currentTarget)}>{toolIcons[tool]}<span className="sr-only">{toolLabels[tool]}</span></button>)}</div>
      <div className="article-reader__progress" role="progressbar" aria-label="文章阅读进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}><span style={{ width: `${progressPercent}%` }} /></div>
    </header>
    {!online ? <aside className="article-reader__notice" role="status">当前离线，阅读位置和标注会先保存在本机。</aside> : null}
    {status ? <aside className="article-reader__notice" role="status">{status}</aside> : null}
    <div className="article-reader__layout">
      <main className="article-reader__content" ref={contentRef} aria-label="西语文章正文">
        <div className="article-reader__body">{article.segments.map((segment) => <ReaderParagraph
          key={segment.position}
          segment={segment}
          highlighted={state.highlights.some((item) => item.position === segment.position)}
          listenTarget={toolsOpen && activeTool === "listen" && activePosition === segment.position}
          selectionStart={selectionVisible && selectedToken?.position === segment.position ? selectedToken.tokenStart : -1}
          selectionEnd={selectionVisible && selectedToken?.position === segment.position ? selectedToken.tokenEnd : -1}
          tabbable={keyboardNavigation}
          onSelectToken={selectToken}
        />)}</div>
        <div className="article-reader__complete"><strong>已读完</strong><span>本次只记录阅读活动，不会增加口语能力。</span>{article.attribution ? <span>{article.attribution}</span> : null}</div>
        <details className="article-reader__transfer-disclosure" open={transferOpen}><summary onClick={(event) => { event.preventDefault(); setTransferOpen((current) => !current); }}>读完后练口语</summary>{transferOpen ? renderTransferPanel() : null}</details>
      </main>
      {toolsOpen ? <aside ref={toolsRef} tabIndex={-1} id="article-reader-tool-panel" className={["article-reader__tools", "is-open", activeTool === "explain" && !toolsPinned ? "is-draggable" : "", draggingTranslator ? "is-dragging" : ""].filter(Boolean).join(" ")} style={activeTool === "explain" && !toolsPinned && translatorPosition ? { left: `${translatorPosition.left}px`, top: `${translatorPosition.top}px`, right: "auto", bottom: "auto", transform: "none" } satisfies CSSProperties : undefined} aria-label="阅读工具" role="dialog" aria-labelledby="article-reader-tools-title"><div className="article-reader__tools-header" data-testid={activeTool === "explain" ? "translator-drag-handle" : undefined} onPointerDown={startTranslatorDrag}><h2 id="article-reader-tools-title">{toolLabels[activeTool]}</h2>{activeTool === "explain" ? <button ref={toolsPinRef} className="article-reader__tools-pin" type="button" aria-label={toolsPinned ? "取消固定翻译器" : "固定翻译器"} aria-pressed={toolsPinned} title={toolsPinned ? "取消固定" : "固定在右侧"} onClick={() => { setTranslatorPosition(null); setToolsPinned((current) => !current); }}><PinIcon pinned={toolsPinned} /></button> : null}</div><div className="article-reader__tool-panel">{renderToolPanel()}</div></aside> : null}
    </div>
    {toolsOpen && !toolsPinned ? <div className="article-reader__scrim" aria-hidden="true" onClick={closeTools} /> : null}
  </div>;
}
