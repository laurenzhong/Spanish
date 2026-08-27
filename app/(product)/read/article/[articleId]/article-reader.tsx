"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { ArticleReaderProjection, ArticleTransferType } from "@/src/modules/content/domain";
import { articleTransferTask, articleTransferTypes, recommendedArticleTransferType } from "@/src/modules/content/domain";
import { readingStatePatchSchema } from "@/src/modules/reading/domain/reading-state";
import { createBrowserTextToSpeech } from "@/src/modules/providers/tts";
import type { WordExplanation } from "@/src/modules/providers/word-explanation";

type SavedPhrase = Readonly<{ id: string; text: string; position: number }>;
type Highlight = Readonly<{ id: string; text: string; position: number }>;
type ReaderSettings = Readonly<{ fontSize: "default" | "large"; lineHeight: "default" | "relaxed"; width: "narrow" | "wide"; theme: "light" | "dim"; ttsRate: number }>;
type ReaderState = Readonly<{ stableKey: string; version: number; contentHash: string; position: number; savedPhrases: readonly SavedPhrase[]; highlights: readonly Highlight[]; note: string; saved: boolean; settings?: ReaderSettings; transferDraft?: string; transferType?: ArticleTransferType | null; status?: "in_progress" | "completed"; lastOpenedAt?: string }>;
type SelectedToken = Readonly<{ text: string; position: number; context: string; selectionType: "word" | "sentence" }>;
type WordExplanationStatus = "idle" | "loading" | "success" | "error";
type ReaderTab = "explain" | "dictionary" | "guide" | "words" | "settings";
type ArticleReaderProps = Readonly<{ article: ArticleReaderProjection }>;

const readerStoragePrefix = "reading-reader:v1:";
const defaultSettings: ReaderSettings = { fontSize: "default", lineHeight: "default", width: "narrow", theme: "light", ttsRate: 0.88 };
const glossary: Readonly<Record<string, { partOfSpeech: string; meaning: string; example: string }>> = {
  aprender: { partOfSpeech: "动词", meaning: "学习、掌握新的知识或技能", example: "Quiero aprender algo nuevo." },
  café: { partOfSpeech: "名词", meaning: "咖啡；也可以指喝咖啡的场所", example: "Nos vemos en el café." },
  mañana: { partOfSpeech: "名词 / 副词", meaning: "明天；早晨", example: "Mañana tengo tiempo." },
  palabra: { partOfSpeech: "名词", meaning: "单词、词语；也可指一句承诺", example: "Esta palabra aparece varias veces." },
  conversación: { partOfSpeech: "名词", meaning: "谈话、对话", example: "La conversación fue muy natural." },
};

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

export function ArticleReader({ article }: ArticleReaderProps) {
  const [state, setState] = useState<ReaderState>(() => initialState(article));
  const [hydrated, setHydrated] = useState(false);
  const [activePosition, setActivePosition] = useState(0);
  const [selectedToken, setSelectedToken] = useState<SelectedToken | null>(null);
  const [wordExplanation, setWordExplanation] = useState<WordExplanation | null>(null);
  const [wordExplanationStatus, setWordExplanationStatus] = useState<WordExplanationStatus>("idle");
  const [wordExplanationError, setWordExplanationError] = useState("");
  const [activeTab, setActiveTab] = useState<ReaderTab>("explain");
  const [toolsOpen, setToolsOpenState] = useState(false);
  const [speakingPosition, setSpeakingPosition] = useState<number | "full" | null>(null);
  const [ttsError, setTtsError] = useState(false);
  const [online, setOnline] = useState(true);
  const [serverSync, setServerSync] = useState<"pending" | "available" | "unauthenticated" | "unavailable" | "conflict">("pending");
  const [status, setStatus] = useState("");
  const [activeTransfer, setActiveTransfer] = useState<ArticleTransferType | null>(null);
  const restoredPositionRef = useRef<number | null>(null);
  const previousOnlineRef = useRef(online);
  const contentRef = useRef<HTMLElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);
  const assistToggleRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const selectionHandledRef = useRef(false);
  const explanationRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const explanationGenerationRef = useRef(0);
  const tts = useMemo(() => createBrowserTextToSpeech(), []);
  const settings = state.settings ?? defaultSettings;
  const closeTools = useCallback(() => {
    explanationRequestRef.current?.controller.abort();
    setWordExplanationStatus("idle");
    setToolsOpenState(false);
  }, []);

  useEffect(() => () => tts.stop(), [tts]);
  useEffect(() => () => explanationRequestRef.current?.controller.abort(), []);
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
        if (isReaderState(saved) && saved.stableKey === article.stableKey && saved.contentHash === article.contentHash) queueMicrotask(() => setState(normalizeReaderState({ ...saved, position: Math.min(saved.position, Math.max(article.segments.length - 1, 0)) })));
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
    if (!hydrated || !online || serverSync !== "available") return;
    const controller = new AbortController();
    const payload = readingStatePatchSchema.safeParse({ contentHash: article.contentHash, highlights: state.highlights, note: state.note, position: state.position, saved: state.saved, savedPhrases: state.savedPhrases, status: state.position >= article.segments.length - 1 ? "completed" : "in_progress" });
    if (!payload.success) return () => controller.abort();
    void fetch("/api/v1/read/articles/" + encodeURIComponent(article.id) + "/state", { body: JSON.stringify(payload.data), credentials: "same-origin", headers: { "content-type": "application/json" }, method: "PATCH", signal: controller.signal }).then((response) => { if (response.status === 409) { setServerSync("conflict"); setStatus("文章版本已更新，当前标注保留在本机；重新打开最新版本后可以重新保存。"); } else if (response.status === 401) setServerSync("unauthenticated"); else if (!response.ok) setServerSync("unavailable"); }).catch(() => { if (!controller.signal.aborted) setServerSync("unavailable"); });
    return () => controller.abort();
  }, [article, hydrated, online, serverSync, state]);
  useEffect(() => { const onOnline = () => setOnline(true); const onOffline = () => setOnline(false); window.addEventListener("online", onOnline); window.addEventListener("offline", onOffline); return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); }; }, []);
  useLayoutEffect(() => { if (!toolsOpen) { explanationRequestRef.current?.controller.abort(); previouslyFocusedRef.current?.focus(); previouslyFocusedRef.current = null; return; } toolsCloseRef.current?.focus(); }, [toolsOpen]);
  useEffect(() => {
    if (!toolsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeTools(); return; }
      if (event.key !== "Tab" || !toolsRef.current) return;
      const focusable = [...toolsRef.current.querySelectorAll<HTMLElement>("button, [href], select, textarea")].filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown); return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeTools, toolsOpen]);
  useEffect(() => { restoredPositionRef.current = null; }, [article]);
  useEffect(() => { if (!hydrated || state.position <= 0 || restoredPositionRef.current !== null) return; restoredPositionRef.current = state.position; requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-reader-position=\"" + state.position + "\"]")?.scrollIntoView({ block: "center" })); }, [hydrated, state.position]);
  const updatePosition = useCallback(() => { const nodes = [...document.querySelectorAll<HTMLElement>("[data-reader-position]")]; const anchor = window.scrollY + window.innerHeight * 0.32; const current = nodes.reduce((candidate, node) => node.offsetTop <= anchor ? Number(node.dataset.readerPosition) : candidate, 0); if (current !== activePosition) setActivePosition(current); setState((previous) => previous.position === current ? previous : { ...previous, position: current }); }, [activePosition]);
  useEffect(() => { let frame = 0; const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updatePosition); }; window.addEventListener("scroll", onScroll, { passive: true }); return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); }; }, [updatePosition]);
  const speak = useCallback(async (text: string, position: number | "full") => { if (!tts.isSupported) { setTtsError(true); return; } setSpeakingPosition(position); setTtsError(false); try { await tts.speak(text, { languageTag: article.locale, rate: settings.ttsRate }); } catch { setTtsError(true); } finally { setSpeakingPosition(null); } }, [article.locale, settings.ttsRate, tts]);
  const selectedGloss = selectedToken ? glossary[normalizeToken(selectedToken.text)] : null;
  const transferTask = activeTransfer ? articleTransferTask(article, activeTransfer) : null;
  const recommendedTransfer = recommendedArticleTransferType(article.oralTransferType);
  const fullText = article.segments.map((segment) => segment.text).join(" ");
  const readerClass = "article-reader article-reader--" + settings.fontSize + " article-reader--" + settings.lineHeight + " article-reader--" + settings.width + " article-reader--" + settings.theme + (toolsOpen ? " article-reader--tools-open" : "");
  const requestWordExplanation = useCallback((token: SelectedToken) => {
    explanationRequestRef.current?.controller.abort();
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
      const payload = (await response.json().catch(() => null)) as { data?: WordExplanation; error?: { message?: string } } | null;
      if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || "解释暂时无法生成，请稍后重试。");
      if (explanationRequestRef.current?.generation !== generation) return;
      setWordExplanation(payload.data);
      setWordExplanationStatus("success");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || explanationRequestRef.current?.generation !== generation) return;
      setWordExplanationStatus("error");
      setWordExplanationError(error instanceof Error ? error.message : "解释暂时无法生成，请稍后重试。");
    });
  }, [article.locale]);
  const selectToken = useCallback((text: string, position: number, context: string) => {
    if (selectionHandledRef.current) return;
    const token = { text, position, context, selectionType: "word" as const };
    setSelectedToken(token);
    setActiveTab("explain");
    previouslyFocusedRef.current = assistToggleRef.current;
    setToolsOpenState(true);
    requestWordExplanation(token);
  }, [requestWordExplanation]);
  const handleTextSelection = useCallback((segment: ArticleReaderProjection["segments"][number], event: MouseEvent<HTMLParagraphElement>) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() ?? "";
    if (selectedText.split(/\s+/u).filter(Boolean).length < 2) return;
    if (!selection?.anchorNode || !selection.focusNode || !event.currentTarget.contains(selection.anchorNode) || !event.currentTarget.contains(selection.focusNode)) return;
    const normalizedSegment = segment.text.replace(/\s+/gu, " ").trim();
    if (!normalizedSegment.includes(selectedText.replace(/\s+/gu, " "))) return;
    selectionHandledRef.current = true;
    window.setTimeout(() => { selectionHandledRef.current = false; }, 0);
    selection.removeAllRanges();
    explanationRequestRef.current?.controller.abort();
    setSelectedToken({ text: selectedText, position: segment.position, context: segment.text, selectionType: "sentence" });
    setWordExplanation(null);
    setWordExplanationError("");
    setWordExplanationStatus("idle");
    setActiveTab("explain");
    previouslyFocusedRef.current = assistToggleRef.current;
    setToolsOpenState(true);
  }, []);
  const toggleSavedPhrase = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.savedPhrases.some((item) => item.id === id); setState((previous) => ({ ...previous, savedPhrases: exists ? previous.savedPhrases.filter((item) => item.id !== id) : [...previous.savedPhrases, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已从本篇 Words 移除。" : "已保存到本篇 Words。"); };
  const toggleHighlight = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.highlights.some((item) => item.id === id); setState((previous) => ({ ...previous, highlights: exists ? previous.highlights.filter((item) => item.id !== id) : [...previous.highlights, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已取消高亮。" : "已标记高亮。"); };
  const updateSetting = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => setState((previous) => ({ ...previous, settings: { ...(previous.settings ?? defaultSettings), [key]: value } }));
  const renderToolPanel = () => {
    if (activeTab === "explain") {
      if (!selectedToken) return <div className="article-reader__tool-empty"><strong>Click any word on the left for a context-aware explanation.</strong><p>点击正文中的词语后，这里会显示结合当前语境的释义、发音和保存动作。</p></div>;
      const id = selectedToken.position + ":" + selectedToken.text;
      const phraseSaved = state.savedPhrases.some((item) => item.id === id);
      const highlighted = state.highlights.some((item) => item.id === id);
      const isSentence = selectedToken.selectionType === "sentence";
      const meaning = wordExplanation?.meaning ?? (isSentence ? undefined : selectedGloss?.meaning);
      const partOfSpeech = wordExplanation?.partOfSpeech ?? (isSentence ? undefined : selectedGloss?.partOfSpeech);
      const example = wordExplanation?.example ?? (isSentence ? undefined : selectedGloss?.example);
      const contextualMeaning = wordExplanation?.contextualMeaning;
      return <>
        <div className="article-reader__selected-word"><span>{selectedToken.text}</span><button type="button" aria-label={"朗读 " + selectedToken.text} onClick={() => void speak(selectedToken.text, selectedToken.position)}>🔊</button></div>
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
          </>}
        </div>
        {isSentence && wordExplanationStatus === "idle" ? <button className="secondary-action" type="button" onClick={() => requestWordExplanation(selectedToken)}>解析所选句子</button> : null}
        {wordExplanationStatus === "loading" ? <p className="article-reader__tool-note" role="status" aria-live="polite">正在生成解释……</p> : null}
        {wordExplanationStatus === "error" ? <div role="alert"><p className="article-reader__tool-note">{wordExplanationError || "解释暂时无法生成，请稍后重试。"}</p><button className="secondary-action" type="button" onClick={() => requestWordExplanation(selectedToken)}>重试解释</button></div> : null}
        <div className="article-reader__tool-actions"><button className="secondary-action" type="button" aria-pressed={phraseSaved} onClick={toggleSavedPhrase}>{phraseSaved ? "已保存" : "保存词语"}</button><button className="secondary-action" type="button" aria-pressed={highlighted} onClick={toggleHighlight}>{highlighted ? "取消高亮" : "高亮"}</button></div>
      </>;
    }
    if (activeTab === "dictionary") return <><div className="article-reader__dictionary-languages"><select aria-label="词典源语言" defaultValue="Spanish"><option>Spanish</option></select><span aria-hidden="true">→</span><select aria-label="词典目标语言" defaultValue="Chinese"><option>Chinese</option></select></div><p>还没有配置 Spanish → Chinese 词典。</p><p><strong>你可以在设置中添加自定义词典</strong>，然后回到这里查询选中的词语。</p>{selectedToken ? <button className="secondary-action" type="button" onClick={() => setActiveTab("explain")}>查看 Explain</button> : null}</>;
    if (activeTab === "guide") return <><p className="article-reader__tool-kicker">文章导览</p><p><strong>{article.title}</strong></p><p>{article.summary}</p><p>这篇文章分为 {article.segments.length} 个段落，建议先通读，再回看标记过的词语。</p></>;
    if (activeTab === "words") { const items = [...state.savedPhrases, ...state.highlights.map((item) => ({ ...item, id: "highlight-" + item.id, text: item.text + "（高亮）" }))]; return items.length ? <ul className="article-reader__saved-list">{items.map((item) => <li key={item.id}><span>{item.text}</span><button type="button" onClick={() => document.querySelector<HTMLElement>("[data-reader-position=\"" + item.position + "\"]")?.scrollIntoView({ block: "center" })}>跳转</button></li>)}</ul> : <div className="article-reader__tool-empty"><strong>还没有保存内容</strong><p>在正文点选词语后，可以保存短语或高亮。</p></div>; }
    return <><label className="article-reader__setting"><span>字号</span><select aria-label="字号" value={settings.fontSize} onChange={(event) => updateSetting("fontSize", event.target.value as ReaderSettings["fontSize"])}><option value="default">标准</option><option value="large">大字</option></select></label><label className="article-reader__setting"><span>行距</span><select aria-label="行距" value={settings.lineHeight} onChange={(event) => updateSetting("lineHeight", event.target.value as ReaderSettings["lineHeight"])}><option value="default">舒适</option><option value="relaxed">宽松</option></select></label><label className="article-reader__setting"><span>正文宽度</span><select aria-label="正文宽度" value={settings.width} onChange={(event) => updateSetting("width", event.target.value as ReaderSettings["width"])}><option value="narrow">专注</option><option value="wide">宽屏</option></select></label><label className="article-reader__setting"><span>背景</span><select aria-label="阅读背景" value={settings.theme} onChange={(event) => updateSetting("theme", event.target.value as ReaderSettings["theme"])}><option value="light">浅色</option><option value="dim">柔和</option></select></label><label className="article-reader__setting"><span>TTS 速度</span><select aria-label="TTS 速度" value={settings.ttsRate} onChange={(event) => updateSetting("ttsRate", Number(event.target.value))}><option value="0.7">慢速</option><option value="0.88">标准</option><option value="1.05">稍快</option></select></label><p className="article-reader__tool-note">设置和标注保存在这篇文章的阅读状态中。</p></>;
  };
  return <div className={readerClass} data-online={online}><header className="article-reader__topbar"><div className="article-reader__topbar-left"><Link className="text-link article-reader__back" href="/read"><span aria-hidden="true">←</span> 返回文章库</Link></div><span className="article-reader__topbar-title">{article.title}</span><div className="article-reader__topbar-actions"><span className="article-reader__streak" aria-label="连续阅读 1 天"><strong>1</strong></span><button className="article-reader__menu" type="button" aria-label="更多阅读选项"><span aria-hidden="true">⋯</span></button><button ref={assistToggleRef} className="article-reader__assist-toggle" type="button" aria-label={toolsOpen ? "关闭阅读辅助" : "打开阅读辅助"} aria-expanded={toolsOpen} onClick={() => { if (!toolsOpen) previouslyFocusedRef.current = assistToggleRef.current; setToolsOpenState((open) => !open); setTimeout(() => { if (!toolsOpen) toolsCloseRef.current?.focus(); }, 0); }}><span aria-hidden="true">▣</span></button></div></header>{!online ? <aside className="article-reader__notice" role="status">当前处于离线状态。已确认的阅读位置和标注会保存在本机，网络恢复后可继续。</aside> : null}{status ? <aside className="article-reader__notice" role="status">{status}</aside> : null}<div className="article-reader__layout"><main className="article-reader__content" ref={contentRef} aria-label="西语文章正文"><h1 className="sr-only">{article.title}</h1><div className="article-reader__document-bar"><span>西语原文</span><div className="article-reader__tool-actions"><button className="secondary-action" type="button" onClick={() => { const segment = article.segments[state.position]; if (segment) void speak(segment.text, state.position); }} disabled={speakingPosition !== null}>{speakingPosition === state.position ? "正在朗读本段" : "朗读本段"}</button><button className="secondary-action" type="button" onClick={() => void speak(fullText, "full")} disabled={speakingPosition !== null}>{speakingPosition === "full" ? "正在朗读全文" : "朗读全文"}</button></div></div>{ttsError ? <p className="article-reader__tts-error" role="status">浏览器暂时无法朗读。正文阅读不受影响，可以稍后重试。</p> : null}{article.segments.map((segment) => { const highlighted = state.highlights.some((item) => item.position === segment.position); const words = segment.text.split(/(\s+)/u); return <p className={highlighted ? "is-highlighted" : ""} data-reader-position={segment.position} key={segment.position} onMouseUp={(event) => handleTextSelection(segment, event)}>{words.map((word, index) => /\s+/u.test(word) ? <span key={segment.position + "-space-" + index}>{word}</span> : <button className="reader-token" type="button" key={segment.position + "-word-" + index} onClick={() => selectToken(word, segment.position, segment.text)}>{word}</button>)}</p>; })}<div className="article-reader__complete"><strong>读到这里，先停一下。</strong><span>阅读完成只记录为阅读活动，不会直接变成口语能力证据。</span></div></main><aside ref={toolsRef} className={"article-reader__tools" + (toolsOpen ? " is-open" : "")} aria-label="阅读辅助" role="dialog" aria-modal={toolsOpen || undefined} aria-labelledby="article-reader-tools-title"><div className="article-reader__tools-header"><div><p id="article-reader-tools-title" className="article-reader__tool-kicker">阅读辅助</p><strong>{selectedToken ? "“" + selectedToken.text + "”" : "跟着文章走"}</strong></div><button ref={toolsCloseRef} className="article-reader__tools-close" type="button" aria-label="关闭阅读辅助" onClick={() => setToolsOpenState(false)}>×</button></div><div className="article-reader__tool-tabs" role="tablist" aria-label="阅读辅助标签">{([['explain', 'Explain'], ['dictionary', 'Dictionary'], ['guide', 'Guide'], ['words', 'Words'], ['settings', 'Settings']] as const).map(([tab, label]) => <button type="button" role="tab" key={tab} className={activeTab === tab ? "is-selected" : ""} aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{label}</button>)}</div><div className="article-reader__tool-panel" role="tabpanel">{renderToolPanel()}</div>{activeTab !== "explain" ? <div className="article-reader__tools-footer"><div className="article-reader__tool-actions"><button className="secondary-action" type="button" onClick={() => void speak(fullText, "full")} disabled={speakingPosition !== null}>{speakingPosition === "full" ? "正在朗读全文" : "朗读全文"}</button><button className="secondary-action" type="button" onClick={() => { tts.stop(); setSpeakingPosition(null); }}>停止</button></div><p className="article-reader__tool-note">阅读、词语查询和朗读不会改变口语能力画像。</p></div> : null}</aside></div>{toolsOpen ? <button className="article-reader__scrim" type="button" aria-label="关闭阅读辅助" onClick={() => setToolsOpenState(false)} /> : null}<section className="article-reader__notes" aria-labelledby="article-reader-note-title"><div><p className="eyebrow eyebrow--accent">个人笔记</p><h2 id="article-reader-note-title">留一句给下次的自己</h2><p>笔记只保存在你的阅读状态里，不会写入能力画像或角色记忆。</p></div><div><textarea value={state.note} onChange={(event) => setState((previous) => ({ ...previous, note: event.target.value.slice(0, 2_000) }))} placeholder="可以写中文或西语……" aria-label="文章个人笔记" /><button className="secondary-action" type="button" onClick={() => setStatus("笔记已保存在本机阅读状态中。")}>保存笔记</button></div></section><section className="article-reader__transfer" data-testid="article-transfer" aria-labelledby="article-transfer-title"><header><p className="eyebrow eyebrow--accent">读到口语</p><h2 id="article-transfer-title">把读到的内容说出来</h2><p>选一个自然的方向。跳过、阅读和打字都只留在阅读状态里；只有主动进入口语复核才会开始训练。</p></header><div className="article-reader__transfer-options" role="group" aria-label="口语迁移方向">{articleTransferTypes.map((type) => { const task = articleTransferTask(article, type); return <button className="article-reader__transfer-option" type="button" key={type} aria-pressed={activeTransfer === type} onClick={() => { setActiveTransfer(type); setState((previous) => ({ ...previous, transferType: type })); }}><strong>{task.label}</strong><span>{task.description}</span>{recommendedTransfer === type ? <small>这篇文章的推荐方向</small> : null}</button>; })}</div>{transferTask ? <div className="article-reader__transfer-panel"><p>{transferTask.prompt}</p><textarea value={state.transferDraft ?? ""} onChange={(event) => setState((previous) => ({ ...previous, transferDraft: event.target.value.slice(0, 2_000) }))} placeholder="可以先写下要说的要点（可选）" aria-label="口语迁移草稿" /><div className="article-reader__transfer-actions"><Link className="primary-link" href={`/learn/practice?article=${encodeURIComponent(article.id)}&transfer=${transferTask.type}`}>进入口语复核</Link><button className="secondary-action" type="button" onClick={() => setStatus("草稿已保存；尚未进入口语评估，也不会改变口语能力画像。继续准备好后，再进入口语复核。")}>先保存草稿</button><button className="secondary-action" type="button" onClick={() => { setActiveTransfer(null); setState((previous) => ({ ...previous, transferDraft: "", transferType: null })); setStatus("已跳过这次口语迁移；阅读完成不会产生口语能力证据。"); }}>跳过这一步</button></div></div> : null}</section></div>;
}
