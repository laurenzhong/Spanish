"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArticleReaderProjection } from "@/src/modules/content/domain";
import {
  articleTransferTask,
  articleTransferTypes,
  recommendedArticleTransferType,
  type ArticleTransferType,
} from "@/src/modules/content/domain";
import { createBrowserTextToSpeech } from "@/src/modules/providers/tts";

type SavedPhrase = Readonly<{ id: string; text: string; position: number }>;
type Highlight = Readonly<{ id: string; text: string; position: number }>;
type ReaderState = Readonly<{
  stableKey: string;
  version: number;
  contentHash: string;
  position: number;
  savedPhrases: readonly SavedPhrase[];
  highlights: readonly Highlight[];
  note: string;
}>;

type ArticleReaderProps = Readonly<{ article: ArticleReaderProjection }>;

const readerStoragePrefix = "reading-reader:v1:";

function initialState(article: ArticleReaderProjection): ReaderState {
  return { stableKey: article.stableKey, version: article.version, contentHash: article.contentHash, position: 0, savedPhrases: [], highlights: [], note: "" };
}

function storageKey(article: ArticleReaderProjection): string {
  return `${readerStoragePrefix}${article.stableKey}`;
}

function isReaderState(value: unknown): value is ReaderState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReaderState>;
  return typeof state.stableKey === "string" && typeof state.version === "number" && typeof state.contentHash === "string" && typeof state.position === "number" && Array.isArray(state.savedPhrases) && Array.isArray(state.highlights) && typeof state.note === "string";
}

function selectedText(): string {
  return typeof window === "undefined" ? "" : window.getSelection()?.toString().trim().replace(/\s+/gu, " ") ?? "";
}

function wordHelp(text: string): string {
  const normalized = text.toLocaleLowerCase();
  if (normalized.includes("cafetería")) return "cafetería：咖啡馆，也可以指提供简餐的校园或街区小店。";
  if (normalized.includes("compañera")) return "compañera：女同学、女同事或女性同伴，具体含义取决于上下文。";
  if (normalized.includes("seguir en contacto")) return "seguir en contacto：保持联系，常用于告别时表达之后还想联系。";
  return "先看它在这一段里和谁、什么动作连在一起，再决定是否需要保存。";
}

export function ArticleReader({ article }: ArticleReaderProps) {
  const [state, setState] = useState<ReaderState>(() => initialState(article));
  const [hydrated, setHydrated] = useState(false);
  const [selected, setSelected] = useState<{ text: string; position: number } | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const [paragraphHelpOpen, setParagraphHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontScale, setFontScale] = useState<"normal" | "large">("normal");
  const [lineHeight, setLineHeight] = useState<"standard" | "relaxed">("standard");
  const [narrowColumn, setNarrowColumn] = useState(true);
  const [activePosition, setActivePosition] = useState(0);
  const [speakingPosition, setSpeakingPosition] = useState<number | "full" | null>(null);
  const [ttsError, setTtsError] = useState(false);
  const [online, setOnline] = useState(true);
  const [status, setStatus] = useState("");
  const [activeTransfer, setActiveTransfer] = useState<ArticleTransferType | null>(null);
  const [transferDraft, setTransferDraft] = useState("");
  const [transferSaved, setTransferSaved] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const tts = useMemo(() => createBrowserTextToSpeech(), []);
  const progressPercent = article.segments.length === 0 ? 0 : Math.round(((state.position + 1) / article.segments.length) * 100);

  useEffect(() => () => tts.stop(), [tts]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(article));
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (isReaderState(saved) && saved.stableKey === article.stableKey && saved.contentHash === article.contentHash) {
          queueMicrotask(() => setState({ ...saved, position: Math.min(saved.position, Math.max(article.segments.length - 1, 0)) }));
        } else if (isReaderState(saved) && saved.version !== article.version) {
          queueMicrotask(() => setStatus("文章版本已更新，旧标注仍保留在原版本；请从第一段或你熟悉的位置重新开始。"));
        }
      }
    } catch {
      queueMicrotask(() => setStatus("暂时无法读取上次的阅读位置，本次阅读仍可继续。"));
    }
    queueMicrotask(() => {
      setOnline(navigator.onLine);
      setHydrated(true);
    });
  }, [article]);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(storageKey(article), JSON.stringify(state)); } catch { /* In-memory progress remains usable. */ }
  }, [article, hydrated, state]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    if (!hydrated || state.position <= 0) return;
    document.querySelector<HTMLElement>(`[data-reader-position="${state.position}"]`)?.scrollIntoView({ block: "center" });
  }, [hydrated, state.position]);

  const updatePosition = useCallback(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-reader-position]")];
    const anchor = window.scrollY + window.innerHeight * 0.32;
    const current = nodes.reduce((candidate, node) => node.offsetTop <= anchor ? Number(node.dataset.readerPosition) : candidate, 0);
    if (current !== activePosition) setActivePosition(current);
    setState((previous) => previous.position === current ? previous : { ...previous, position: current });
  }, [activePosition]);

  useEffect(() => {
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(updatePosition); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); };
  }, [updatePosition]);

  const inspectSelection = useCallback((position: number) => {
    const text = selectedText();
    if (!text) return;
    setSelected({ text, position });
    setHelperOpen(true);
  }, []);

  const savePhrase = useCallback(() => {
    if (!selected) return;
    setState((previous) => previous.savedPhrases.some((phrase) => phrase.text === selected.text && phrase.position === selected.position) ? previous : { ...previous, savedPhrases: [...previous.savedPhrases, { ...selected, id: `${selected.position}:${selected.text}` }] });
    setStatus(`已保存短语：“${selected.text}”`);
  }, [selected]);

  const saveHighlight = useCallback(() => {
    if (!selected) return;
    setState((previous) => previous.highlights.some((highlight) => highlight.text === selected.text && highlight.position === selected.position) ? previous : { ...previous, highlights: [...previous.highlights, { ...selected, id: `${selected.position}:${selected.text}` }] });
    setStatus("已添加高亮。");
  }, [selected]);

  const speak = useCallback(async (text: string, position: number | "full") => {
    if (!tts.isSupported) { setTtsError(true); return; }
    setSpeakingPosition(position); setTtsError(false);
    try { await tts.speak(text, { languageTag: article.locale, rate: 0.88 }); } catch { setTtsError(true); } finally { setSpeakingPosition(null); }
  }, [article.locale, tts]);

  const fullText = article.segments.map((segment) => segment.text).join(" ");
  const recommendedTransfer = recommendedArticleTransferType(article.oralTransferType);
  const transferTask = activeTransfer ? articleTransferTask(article, activeTransfer) : null;
  const transferHref = transferTask
    ? `/learn/practice?article=${encodeURIComponent(article.id)}&transfer=${transferTask.type}`
    : "/learn/practice";
  const readerClass = `article-reader${fontScale === "large" ? " article-reader--large" : ""}${lineHeight === "relaxed" ? " article-reader--relaxed" : ""}${narrowColumn ? " article-reader--narrow" : ""}`;

  return (
    <div className={readerClass} data-online={online}>
      <header className="article-reader__topbar">
        <Link className="text-link" href="/read"><span aria-hidden="true">←</span> 返回文章库</Link>
        <span className="article-reader__counter">第 {state.position + 1} / {article.segments.length} 段</span>
        <button className="secondary-action article-reader__settings-toggle" type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}>阅读设置</button>
      </header>

      <section className="article-reader__progress" aria-label="阅读进度">
        <div className="article-reader__progress-copy"><span>阅读进度</span><strong>{progressPercent}%</strong></div>
        <div className="article-reader__progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent} aria-label="文章阅读进度"><span style={{ width: `${progressPercent}%` }} /></div>
      </section>

      {settingsOpen ? (
        <section className="article-reader__settings" aria-label="阅读设置">
          <label>字号 <select value={fontScale} onChange={(event) => setFontScale(event.target.value as typeof fontScale)}><option value="normal">标准</option><option value="large">大号</option></select></label>
          <label>行距 <select value={lineHeight} onChange={(event) => setLineHeight(event.target.value as typeof lineHeight)}><option value="standard">标准</option><option value="relaxed">宽松</option></select></label>
          <label><input type="checkbox" checked={narrowColumn} onChange={(event) => setNarrowColumn(event.target.checked)} /> 窄栏阅读</label>
        </section>
      ) : null}

      {!online ? <aside className="article-reader__notice" role="status">当前处于离线状态。已确认的阅读位置和标注会保存在本机，网络恢复后可继续。</aside> : null}
      {status ? <aside className="article-reader__notice" role="status">{status}</aside> : null}

      <header className="article-reader__header">
        <div className="article-reader__meta"><span>{article.cefr}</span><span>{article.estimatedReadingMinutes} 分钟</span><span>{article.region}</span></div>
        <h1>{article.title}</h1>
        <p>{article.summary}</p>
        <div className="article-reader__source"><span>{article.sourceName}{article.author ? ` · ${article.author}` : ""}</span>{article.sourceUrl ? <a href={article.sourceUrl} target="_blank" rel="noreferrer">查看原文 <span aria-hidden="true">↗</span></a> : null}</div>
      </header>

      <div className="article-reader__layout">
        <main className="article-reader__content" ref={contentRef} aria-label="西语文章正文">
          {article.segments.map((segment) => {
            const highlighted = state.highlights.some((item) => item.position === segment.position);
            return <p className={highlighted ? "is-highlighted" : ""} data-reader-position={segment.position} key={segment.position} onMouseUp={() => inspectSelection(segment.position)} onKeyUp={() => inspectSelection(segment.position)}><span className="article-reader__segment-index" aria-hidden="true">{String(segment.position + 1).padStart(2, "0")}</span>{highlighted ? <mark>{segment.text}</mark> : segment.text}</p>;
          })}
          <div className="article-reader__complete"><strong>读到这里，先停一下。</strong><span>阅读完成只记录为阅读活动，不会直接变成口语能力证据。</span></div>
        </main>

        <aside className="article-reader__tools" aria-label="文章辅助工具">
          <button className="primary-link" type="button" onClick={() => void speak(fullText, "full")} disabled={speakingPosition !== null}>{speakingPosition === "full" ? "正在朗读全文" : "播放全文"}</button>
          <button className="secondary-action" type="button" onClick={() => setParagraphHelpOpen((open) => !open)} aria-expanded={paragraphHelpOpen}>段落辅助</button>
          <button className="secondary-action" type="button" onClick={() => { const segment = article.segments[state.position]; if (segment) void speak(segment.text, state.position); }} disabled={speakingPosition !== null}>{speakingPosition === state.position ? "正在朗读本段" : "朗读本段"}</button>
          {paragraphHelpOpen ? <div className="article-reader__helper"><strong>先抓住这一段的关系</strong><p>先读懂谁在做什么、事情如何发展，再回到西语原文确认细节。这是阅读策略提示，不是原文翻译。</p></div> : null}
          {helperOpen ? <div className="article-reader__helper" role="dialog" aria-label="词语辅助"><button className="article-reader__helper-close" type="button" onClick={() => setHelperOpen(false)} aria-label="关闭词语辅助">×</button><strong lang="es">{selected?.text}</strong><p>{wordHelp(selected?.text ?? "")}</p><button className="secondary-action" type="button" onClick={savePhrase}>保存短语</button><button className="secondary-action" type="button" onClick={saveHighlight}>添加高亮</button></div> : <p className="article-reader__tool-note">选中正文中的词语或短语，可查看快速辅助并保存。</p>}
          {ttsError ? <p className="article-reader__tool-error" role="status">浏览器暂时无法朗读。你仍可以继续阅读，稍后重试。</p> : null}
        </aside>
      </div>

      <section className="article-reader__notes" aria-labelledby="article-reader-note-title"><div><p className="eyebrow eyebrow--accent">个人笔记</p><h2 id="article-reader-note-title">留一句给下次的自己</h2><p>笔记只保存在你的阅读状态里，不会写入能力画像或角色记忆。</p></div><div><textarea value={state.note} onChange={(event) => setState((previous) => ({ ...previous, note: event.target.value.slice(0, 2_000) }))} placeholder="可以写中文或西语……" aria-label="文章个人笔记" /><button className="secondary-action" type="button" onClick={() => setStatus("笔记已保存在本机阅读状态中。")}>保存笔记</button></div></section>
      <section className="article-reader__transfer" data-testid="article-transfer" aria-labelledby="article-transfer-title">
        <header>
          <p className="eyebrow eyebrow--accent">读到口语</p>
          <h2 id="article-transfer-title">把读到的内容说出来</h2>
          <p>选一个自然的方向。跳过、阅读和打字都只留在阅读状态里；只有主动进入口语复核才会开始训练。</p>
        </header>
        <div className="article-reader__transfer-options" role="group" aria-label="口语迁移方向">
          {articleTransferTypes.map((type) => {
            const task = articleTransferTask(article, type);
            return (
              <button
                className="article-reader__transfer-option"
                type="button"
                key={type}
                aria-pressed={activeTransfer === type}
                onClick={() => { setActiveTransfer(type); setTransferSaved(false); }}
              >
                <strong>{task.label}</strong>
                <span>{task.description}</span>
                {recommendedTransfer === type ? <small>这篇文章的推荐方向</small> : null}
              </button>
            );
          })}
        </div>
        {transferTask ? (
          <div className="article-reader__transfer-panel">
            <p>{transferTask.prompt}</p>
            <textarea
              value={transferDraft}
              onChange={(event) => { setTransferDraft(event.target.value.slice(0, 2_000)); setTransferSaved(false); }}
              placeholder="可以先写下要说的要点（可选）"
              aria-label="口语迁移草稿"
            />
            {transferSaved ? <p className="article-reader__transfer-saved">草稿已保存在本机阅读状态中，尚未进入口语评估。</p> : null}
            <div className="article-reader__transfer-actions">
              <Link className="primary-link" href={transferHref}>进入口语复核</Link>
              <button className="secondary-action" type="button" onClick={() => { setTransferSaved(true); setStatus("草稿已保存；尚未进入口语评估，也不会改变口语能力画像。继续准备好后，再进入口语复核。"); }}>先保存草稿</button>
              <button className="secondary-action" type="button" onClick={() => { setActiveTransfer(null); setTransferDraft(""); setTransferSaved(false); setStatus("已跳过这次口语迁移；阅读完成不会产生口语能力证据。"); }}>跳过这一步</button>
            </div>
          </div>
        ) : null}
      </section>
      {state.savedPhrases.length > 0 ? <section className="article-reader__saved" aria-labelledby="article-reader-saved-title"><div className="section-heading"><div><p className="eyebrow eyebrow--accent">已保存</p><h2 id="article-reader-saved-title">这篇文章里的短语</h2></div><span>{state.savedPhrases.length} 条</span></div><ul>{state.savedPhrases.map((phrase) => <li key={phrase.id}><span lang="es">{phrase.text}</span><button type="button" onClick={() => setState((previous) => ({ ...previous, savedPhrases: previous.savedPhrases.filter((item) => item.id !== phrase.id) }))}>移除</button></li>)}</ul></section> : null}
    </div>
  );
}
