"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArticleReaderProjection } from "@/src/modules/content/domain";
import { readingStatePatchSchema } from "@/src/modules/reading/domain/reading-state";
import { createBrowserTextToSpeech } from "@/src/modules/providers/tts";

type SavedPhrase = Readonly<{ id: string; text: string; position: number }>;
type Highlight = Readonly<{ id: string; text: string; position: number }>;
type ReaderSettings = Readonly<{ fontSize: "default" | "large"; lineHeight: "default" | "relaxed"; width: "narrow" | "wide"; theme: "light" | "dim"; ttsRate: number }>;
type ReaderState = Readonly<{ stableKey: string; version: number; contentHash: string; position: number; savedPhrases: readonly SavedPhrase[]; highlights: readonly Highlight[]; note: string; saved: boolean; settings?: ReaderSettings; status?: "in_progress" | "completed"; lastOpenedAt?: string }>;
type SelectedToken = Readonly<{ text: string; position: number; context: string }>;
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
  describía: { partOfSpeech: "动词 · 过去未完成时", meaning: "描述、叙述（过去持续或反复发生的动作）", example: "Fernando describía su vida en el pueblo." },
};

function initialState(article: ArticleReaderProjection): ReaderState {
  return { stableKey: article.stableKey, version: article.version, contentHash: article.contentHash, position: 0, savedPhrases: [], highlights: [], note: "", saved: false, settings: defaultSettings };
}
function storageKey(article: ArticleReaderProjection): string { return readerStoragePrefix + article.stableKey; }
function isReaderState(value: unknown): value is ReaderState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReaderState>;
  return typeof state.stableKey === "string" && typeof state.version === "number" && typeof state.contentHash === "string" && typeof state.position === "number" && Array.isArray(state.savedPhrases) && Array.isArray(state.highlights) && typeof state.note === "string";
}
function normalizeReaderState(value: ReaderState): ReaderState {
  return { ...value, saved: typeof value.saved === "boolean" ? value.saved : false, settings: value.settings ? { ...defaultSettings, ...value.settings } : defaultSettings };
}
function remoteState(value: unknown): { contentHash: string; highlights: Highlight[]; note: string; position: number; saved: boolean; savedPhrases: SavedPhrase[]; status: "in_progress" | "completed" } | null {
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
  const [activeTab, setActiveTab] = useState<ReaderTab>("explain");
  const [toolsOpen, setToolsOpenState] = useState(false);
  const setToolsOpen = (open: boolean) => setToolsOpenState((current) => open ? !current : false);
  const [speakingPosition, setSpeakingPosition] = useState<number | "full" | null>(null);
  const [ttsError, setTtsError] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [serverSync, setServerSync] = useState<"pending" | "available" | "unauthenticated" | "unavailable" | "conflict">("pending");
  const [status, setStatus] = useState("");
  const restoredPositionRef = useRef<number | null>(null);
  const previousOnlineRef = useRef(online);
  const contentRef = useRef<HTMLElement>(null);
  const tts = useMemo(() => createBrowserTextToSpeech(), []);
  const settings = state.settings ?? defaultSettings;

  useEffect(() => () => tts.stop(), [tts]);
  useEffect(() => {
    const recoveredFromOffline = !previousOnlineRef.current && online;
    previousOnlineRef.current = online;
    if (serverSync === "available" || serverSync === "unauthenticated" || serverSync === "conflict") return;
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
  useEffect(() => { restoredPositionRef.current = null; }, [article]);
  useEffect(() => { if (!hydrated || state.position <= 0 || restoredPositionRef.current !== null) return; restoredPositionRef.current = state.position; requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-reader-position=\"" + state.position + "\"]")?.scrollIntoView({ block: "center" })); }, [hydrated, state.position]);

  const updatePosition = useCallback(() => { const nodes = [...document.querySelectorAll<HTMLElement>("[data-reader-position]")]; const anchor = window.scrollY + window.innerHeight * 0.32; const current = nodes.reduce((candidate, node) => node.offsetTop <= anchor ? Number(node.dataset.readerPosition) : candidate, 0); if (current !== activePosition) setActivePosition(current); setState((previous) => previous.position === current ? previous : { ...previous, position: current }); }, [activePosition]);
  useEffect(() => { let frame = 0; const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updatePosition); }; window.addEventListener("scroll", onScroll, { passive: true }); return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); }; }, [updatePosition]);
  const speak = useCallback(async (text: string, position: number | "full") => { if (!tts.isSupported) { setTtsError(true); return; } setSpeakingPosition(position); setTtsError(false); try { await tts.speak(text, { languageTag: article.locale, rate: settings.ttsRate }); } catch { setTtsError(true); } finally { setSpeakingPosition(null); } }, [article.locale, settings.ttsRate, tts]);
  const selectedGloss = selectedToken ? glossary[normalizeToken(selectedToken.text)] : null;
  const readerClass = "article-reader article-reader--" + settings.fontSize + " article-reader--" + settings.lineHeight + " article-reader--" + settings.width + " article-reader--" + settings.theme + (toolsOpen ? " article-reader--tools-open" : "");
  const selectToken = (text: string, position: number, context: string) => { setSelectedToken({ text, position, context }); setActiveTab("explain"); setToolsOpenState(true); };
  const toggleSavedPhrase = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.savedPhrases.some((item) => item.id === id); setState((previous) => ({ ...previous, savedPhrases: exists ? previous.savedPhrases.filter((item) => item.id !== id) : [...previous.savedPhrases, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已从本篇 Words 移除。" : "已保存到本篇 Words。"); };
  const toggleHighlight = () => { if (!selectedToken) return; const id = selectedToken.position + ":" + selectedToken.text; const exists = state.highlights.some((item) => item.id === id); setState((previous) => ({ ...previous, highlights: exists ? previous.highlights.filter((item) => item.id !== id) : [...previous.highlights, { id, text: selectedToken.text, position: selectedToken.position }] })); setStatus(exists ? "已取消高亮。" : "已标记高亮。"); };
  const updateSetting = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => setState((previous) => ({ ...previous, settings: { ...(previous.settings ?? defaultSettings), [key]: value } }));

  const renderToolPanel = () => {
    if (activeTab === "explain") {
      if (!selectedToken) return <div className="article-reader__tool-empty"><strong>Click any word on the left for a context-aware explanation.</strong><p>点击正文中的词语后，这里会显示结合当前语境的释义、发音和保存动作。</p></div>;
      const id = selectedToken.position + ":" + selectedToken.text; const phraseSaved = state.savedPhrases.some((item) => item.id === id); const highlighted = state.highlights.some((item) => item.id === id);
      return <><div className="article-reader__selected-word"><span>{selectedToken.text}{selectedGloss ? " - " + selectedGloss.meaning.split(/[；（]/u)[0] : ""}</span><button type="button" aria-label={"朗读 " + selectedToken.text} onClick={() => void speak(selectedToken.text, selectedToken.position)}>🔊</button></div><p className="article-reader__tool-kicker">{selectedGloss?.partOfSpeech ?? "词语辅助"}</p><p><strong>{selectedGloss?.meaning ?? "当前语境中的词语"}</strong></p><p>上下文：{selectedToken.context}</p>{selectedGloss ? <p className="article-reader__tool-note">例句：{selectedGloss.example}</p> : <p className="article-reader__tool-note">这是基于文章上下文的内部辅助，不影响你的能力评分。</p>}<div className="article-reader__tool-actions"><button className="secondary-action" type="button" aria-pressed={phraseSaved} onClick={toggleSavedPhrase}>{phraseSaved ? "已保存" : "保存词语"}</button><button className="secondary-action" type="button" aria-pressed={highlighted} onClick={toggleHighlight}>{highlighted ? "取消高亮" : "高亮"}</button></div></>;
    }
    if (activeTab === "dictionary") return <><div className="article-reader__dictionary-languages"><select aria-label="词典源语言" defaultValue="Spanish"><option>Spanish</option></select><span aria-hidden="true">→</span><select aria-label="词典目标语言" defaultValue="Chinese"><option>Chinese</option></select></div><p>还没有配置 Spanish → Chinese 词典。</p><p><strong>你可以在设置中添加自定义词典</strong>，然后回到这里查询选中的词语。</p>{selectedToken ? <button className="secondary-action" type="button" onClick={() => setActiveTab("explain")}>查看 Explain</button> : null}</>;
    if (activeTab === "guide") return <><p className="article-reader__tool-kicker">文章导览</p><p><strong>{article.title}</strong></p><p>{article.summary}</p><p>这篇文章分为 {article.segments.length} 个段落，建议先通读，再回看标记过的词语。</p></>;
    if (activeTab === "words") { const items = [...state.savedPhrases, ...state.highlights.map((item) => ({ ...item, id: "highlight-" + item.id, text: item.text + "（高亮）" }))]; return items.length ? <ul className="article-reader__saved-list">{items.map((item) => <li key={item.id}><span>{item.text}</span><button type="button" onClick={() => document.querySelector<HTMLElement>("[data-reader-position=\"" + item.position + "\"]")?.scrollIntoView({ block: "center" })}>跳转</button></li>)}</ul> : <div className="article-reader__tool-empty"><strong>还没有保存内容</strong><p>在正文点选词语后，可以保存短语或高亮。</p></div>; }
    return <><label className="article-reader__setting"><span>字号</span><select aria-label="字号" value={settings.fontSize} onChange={(event) => updateSetting("fontSize", event.target.value as ReaderSettings["fontSize"])}><option value="default">标准</option><option value="large">大字</option></select></label><label className="article-reader__setting"><span>行距</span><select aria-label="行距" value={settings.lineHeight} onChange={(event) => updateSetting("lineHeight", event.target.value as ReaderSettings["lineHeight"])}><option value="default">舒适</option><option value="relaxed">宽松</option></select></label><label className="article-reader__setting"><span>正文宽度</span><select aria-label="正文宽度" value={settings.width} onChange={(event) => updateSetting("width", event.target.value as ReaderSettings["width"])}><option value="narrow">专注</option><option value="wide">宽屏</option></select></label><label className="article-reader__setting"><span>背景</span><select aria-label="阅读背景" value={settings.theme} onChange={(event) => updateSetting("theme", event.target.value as ReaderSettings["theme"])}><option value="light">浅色</option><option value="dim">柔和</option></select></label><label className="article-reader__setting"><span>TTS 速度</span><select aria-label="TTS 速度" value={settings.ttsRate} onChange={(event) => updateSetting("ttsRate", Number(event.target.value))}><option value="0.7">慢速</option><option value="0.88">标准</option><option value="1.05">稍快</option></select></label><p className="article-reader__tool-note">设置和标注保存在这篇文章的阅读状态中。</p></>;
  };

  return <div className={readerClass} data-online={online}><header className="article-reader__topbar"><div className="article-reader__topbar-left"><Link className="text-link article-reader__back" href="/read"><span aria-hidden="true">←</span> 返回文章库</Link></div><span className="article-reader__topbar-title">{article.title}</span><div className="article-reader__topbar-actions"><span className="article-reader__streak" aria-label="连续阅读 1 天"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3c1.3 2.4 3.7 3.9 3.7 7.1 0 1.2-.4 2.2-1.1 3.1.1-2.1-1.1-3.6-2.6-4.6.1 2.6-2.5 3.8-2.5 6.1 0 1.3 1 2.5 2.4 2.5 2.5 0 4.5-2 4.5-4.7 2.1 2.6 2.4 5.2 1.4 7.6-1.1 2.5-3.4 4-6.1 4-4.2 0-7.2-3.4-7.2-7.6C4.5 13 8.5 9.6 12 3Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"/></svg><strong>1</strong></span><button className="article-reader__menu" type="button" aria-label="更多阅读选项"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5.5v.1M12 11.9v.1M12 18.3v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.8"/></svg></button><button className="article-reader__assist-toggle" type="button" aria-label={toolsOpen ? "关闭阅读辅助" : "打开阅读辅助"} aria-expanded={toolsOpen} onClick={() => setToolsOpen(true)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16v14H4zM8 5v14M11 8h6M11 12h6M11 16h4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6"/></svg></button></div></header>{!online ? <aside className="article-reader__notice" role="status">当前处于离线状态。已确认的阅读位置和标注会保存在本机，网络恢复后可继续。</aside> : null}{status ? <aside className="article-reader__notice" role="status">{status}</aside> : null}<div className="article-reader__layout"><main className="article-reader__content" ref={contentRef} aria-label="西语文章正文"><h1 className="sr-only">{article.title}</h1>{ttsError ? <p className="article-reader__tts-error" role="status">浏览器暂时无法朗读。正文阅读不受影响，可以稍后重试。</p> : null}{article.segments.map((segment) => { const highlighted = state.highlights.some((item) => item.position === segment.position); const words = segment.text.split(/(\s+)/u); return <p className={highlighted ? "is-highlighted" : ""} data-reader-position={segment.position} key={segment.position}>{words.map((word, index) => /\s+/u.test(word) ? <span key={segment.position + "-space-" + index}>{word}</span> : <button className="reader-token" type="button" key={segment.position + "-word-" + index} onClick={() => selectToken(word, segment.position, segment.text)}>{word}</button>)}</p>; })}</main><aside className={"article-reader__tools" + (toolsOpen ? " is-open" : "")} aria-label="阅读辅助"><div className="article-reader__tools-header"><div><p className="article-reader__tool-kicker">阅读辅助</p><strong>{selectedToken ? "“" + selectedToken.text + "”" : "跟着文章走"}</strong></div><button className="article-reader__tools-close" type="button" aria-label="关闭阅读辅助" onClick={() => setToolsOpen(false)}>×</button></div><div className="article-reader__tool-tabs" role="tablist" aria-label="阅读辅助标签">{([["explain", "Explain"], ["dictionary", "Dictionary"], ["guide", "Guide"], ["words", "Words"], ["settings", "Settings"]] as const).map(([tab, label]) => <button type="button" role="tab" key={tab} className={activeTab === tab ? "is-selected" : ""} aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)}>{label}</button>)}</div><div className="article-reader__tool-panel" role="tabpanel">{renderToolPanel()}</div><div className="article-reader__tools-footer"><div className="article-reader__tool-actions"><button className="secondary-action" type="button" onClick={() => void speak(article.segments.map((segment) => segment.text).join(" "), "full")} disabled={speakingPosition !== null}>{speakingPosition === "full" ? "正在朗读全文" : "朗读全文"}</button><button className="secondary-action" type="button" onClick={() => { tts.stop(); setSpeakingPosition(null); }}>停止</button></div><p className="article-reader__tool-note">阅读、词语查询和朗读不会改变口语能力画像。</p></div></aside></div>{toolsOpen ? <button className="article-reader__scrim" type="button" aria-label="关闭阅读辅助" onClick={() => setToolsOpen(false)} /> : null}</div>;
}
