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
import { readingStatePatchSchema } from "@/src/modules/reading/domain/reading-state";
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
  saved: boolean;
  status?: "in_progress" | "completed";
  lastOpenedAt?: string;
}>;
type ArticleReaderProps = Readonly<{ article: ArticleReaderProjection }>;

const readerStoragePrefix = "reading-reader:v1:";

function initialState(article: ArticleReaderProjection): ReaderState {
  return { stableKey: article.stableKey, version: article.version, contentHash: article.contentHash, position: 0, savedPhrases: [], highlights: [], note: "", saved: false };
}

function storageKey(article: ArticleReaderProjection): string {
  return `${readerStoragePrefix}${article.stableKey}`;
}

function isReaderState(value: unknown): value is ReaderState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<ReaderState>;
  return typeof state.stableKey === "string" && typeof state.version === "number" && typeof state.contentHash === "string" && typeof state.position === "number" && Array.isArray(state.savedPhrases) && Array.isArray(state.highlights) && typeof state.note === "string";
}

function normalizeReaderState(value: ReaderState): ReaderState {
  return { ...value, saved: typeof value.saved === "boolean" ? value.saved : false };
}

function remoteState(value: unknown): { contentHash: string; highlights: Highlight[]; note: string; position: number; saved: boolean; savedPhrases: SavedPhrase[]; status: "in_progress" | "completed" } | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const parsed = readingStatePatchSchema.safeParse({
    contentHash: state.contentHash,
    highlights: state.highlights,
    note: state.note,
    position: state.position,
    saved: state.saved,
    savedPhrases: state.savedPhrases,
    status: state.status,
  });
  if (!parsed.success) return null;
  return {
    ...parsed.data,
    highlights: parsed.data.highlights.map((item) => ({ ...item, id: `${item.position}:${item.text}` })),
    savedPhrases: parsed.data.savedPhrases.map((item) => ({ ...item, id: `${item.position}:${item.text}` })),
  };
}

export function ArticleReader({ article }: ArticleReaderProps) {
  const [state, setState] = useState<ReaderState>(() => initialState(article));
  const [hydrated, setHydrated] = useState(false);
  const [activePosition, setActivePosition] = useState(0);
  const [speakingPosition, setSpeakingPosition] = useState<number | "full" | null>(null);
  const [ttsError, setTtsError] = useState(false);
  const [online, setOnline] = useState(true);
  const [serverSync, setServerSync] = useState<"pending" | "available" | "unauthenticated" | "unavailable" | "conflict">("pending");
  const [status, setStatus] = useState("");
  const [activeTransfer, setActiveTransfer] = useState<ArticleTransferType | null>(null);
  const [transferDraft, setTransferDraft] = useState("");
  const restoredPositionRef = useRef<number | null>(null);
  const [transferSaved, setTransferSaved] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const tts = useMemo(() => createBrowserTextToSpeech(), []);
  useEffect(() => () => tts.stop(), [tts]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(article));
      if (raw) {
        const saved: unknown = JSON.parse(raw);
        if (isReaderState(saved) && saved.stableKey === article.stableKey && saved.contentHash === article.contentHash) {
          queueMicrotask(() => setState(normalizeReaderState({ ...saved, position: Math.min(saved.position, Math.max(article.segments.length - 1, 0)) })));
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
    let cancelled = false;
    void fetch(`/api/v1/read/articles/${encodeURIComponent(article.id)}/state`, { credentials: "same-origin" })
      .then(async (response) => {
        if (response.status === 401) {
          if (!cancelled) setServerSync("unauthenticated");
          return;
        }
        if (!response.ok) throw new Error("state-unavailable");
        const payload = (await response.json()) as { data?: { state?: unknown } };
        const remote = remoteState(payload.data?.state);
        if (!cancelled && remote) {
          if (remote.contentHash !== article.contentHash) {
            setStatus("服务端保留了旧文章版本的阅读标注；当前版本从本地位置继续，旧标注不会被覆盖。");
            setServerSync("conflict");
            return;
          }
          setState((previous) => ({
            ...previous,
            contentHash: remote.contentHash,
            highlights: remote.highlights,
            note: remote.note,
            position: Math.min(remote.position, Math.max(article.segments.length - 1, 0)),
            saved: remote.saved,
            savedPhrases: remote.savedPhrases,
          }));
        }
        if (!cancelled) setServerSync("available");
      })
      .catch(() => {
        if (!cancelled) setServerSync("unavailable");
      });
    return () => { cancelled = true; };
  }, [article]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey(article), JSON.stringify({ ...state, status: state.position >= article.segments.length - 1 ? "completed" : "in_progress", lastOpenedAt: new Date().toISOString() }));
    } catch {
      // In-memory progress remains usable when browser storage is unavailable.
    }
  }, [article, hydrated, state]);

  useEffect(() => {
    if (!hydrated || !online || serverSync !== "available") return;
    const controller = new AbortController();
    const statusValue = state.position >= article.segments.length - 1 ? "completed" : "in_progress";
    const payload = readingStatePatchSchema.safeParse({
      contentHash: article.contentHash,
      highlights: state.highlights,
      note: state.note,
      position: state.position,
      saved: state.saved,
      savedPhrases: state.savedPhrases,
      status: statusValue,
    });
    if (!payload.success) return () => controller.abort();
    void fetch(`/api/v1/read/articles/${encodeURIComponent(article.id)}/state`, {
      body: JSON.stringify(payload.data),
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "PATCH",
      signal: controller.signal,
    }).then((response) => {
      if (response.status === 409) {
        setServerSync("conflict");
        setStatus("文章版本已更新，当前标注保留在本机；重新打开最新版本后可以重新保存。");
      } else if (response.status === 401) {
        setServerSync("unauthenticated");
      } else if (!response.ok) {
        setServerSync("unavailable");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setServerSync("unavailable");
    });
    return () => controller.abort();
  }, [article, hydrated, online, serverSync, state]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  useEffect(() => {
    restoredPositionRef.current = null;
  }, [article]);

  useEffect(() => {
    if (!hydrated || state.position <= 0) return;
    if (restoredPositionRef.current !== null) return;
    restoredPositionRef.current = state.position;
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-reader-position="${state.position}"]`)?.scrollIntoView({ block: "center" });
    });
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

  const speak = useCallback(async (text: string, position: number | "full") => {
    if (!tts.isSupported) { setTtsError(true); return; }
    setSpeakingPosition(position); setTtsError(false);
    try { await tts.speak(text, { languageTag: article.locale, rate: 0.88 }); } catch { setTtsError(true); } finally { setSpeakingPosition(null); }
  }, [article.locale, tts]);

  const recommendedTransfer = recommendedArticleTransferType(article.oralTransferType);
  const transferTask = activeTransfer ? articleTransferTask(article, activeTransfer) : null;
  const transferHref = transferTask
    ? `/learn/practice?article=${encodeURIComponent(article.id)}&transfer=${transferTask.type}`
    : "/learn/practice";
  const readerClass = "article-reader";

  return (
    <div className={readerClass} data-online={online}>
      <header className="article-reader__topbar">
        <Link className="text-link article-reader__back" href="/read"><span aria-hidden="true">←</span> 返回文章库</Link>
      </header>

      {!online ? <aside className="article-reader__notice" role="status">当前处于离线状态。已确认的阅读位置和标注会保存在本机，网络恢复后可继续。</aside> : null}
      {status ? <aside className="article-reader__notice" role="status">{status}</aside> : null}

      <header className="article-reader__header">
        <h1>{article.title}</h1>
        <p>{article.summary}</p>
        <div className="article-reader__source"><span>{article.sourceName}{article.author ? ` · ${article.author}` : ""}</span>{article.sourceUrl ? <a href={article.sourceUrl} target="_blank" rel="noreferrer">查看原文 <span aria-hidden="true">↗</span></a> : null}</div>
      </header>

      <div className="article-reader__layout">
        <main className="article-reader__content" ref={contentRef} aria-label="西语文章正文">
          <div className="article-reader__document-bar"><span>西语原文</span><button className="secondary-action" type="button" onClick={() => { const segment = article.segments[state.position]; if (segment) void speak(segment.text, state.position); }} disabled={speakingPosition !== null}>{speakingPosition === state.position ? "正在朗读本段" : "朗读本段"}</button></div>
          {ttsError ? <p className="article-reader__tts-error" role="status">浏览器暂时无法朗读。正文阅读不受影响，可以稍后重试。</p> : null}
          {article.segments.map((segment) => <p data-reader-position={segment.position} key={segment.position}>{segment.text}</p>)}
          <div className="article-reader__complete"><strong>读到这里，先停一下。</strong><span>阅读完成只记录为阅读活动，不会直接变成口语能力证据。</span></div>
        </main>
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
            return <button className="article-reader__transfer-option" type="button" key={type} aria-pressed={activeTransfer === type} onClick={() => { setActiveTransfer(type); setTransferSaved(false); }}><strong>{task.label}</strong><span>{task.description}</span>{recommendedTransfer === type ? <small>这篇文章的推荐方向</small> : null}</button>;
          })}
        </div>
        {transferTask ? <div className="article-reader__transfer-panel"><p>{transferTask.prompt}</p><textarea value={transferDraft} onChange={(event) => { setTransferDraft(event.target.value.slice(0, 2_000)); setTransferSaved(false); }} placeholder="可以先写下要说的要点（可选）" aria-label="口语迁移草稿" />{transferSaved ? <p className="article-reader__transfer-saved">草稿已保存在本机阅读状态中，尚未进入口语评估。</p> : null}<div className="article-reader__transfer-actions"><Link className="primary-link" href={transferHref}>进入口语复核</Link><button className="secondary-action" type="button" onClick={() => { setTransferSaved(true); setStatus("草稿已保存；尚未进入口语评估，也不会改变口语能力画像。继续准备好后，再进入口语复核。"); }}>先保存草稿</button><button className="secondary-action" type="button" onClick={() => { setActiveTransfer(null); setTransferDraft(""); setTransferSaved(false); setStatus("已跳过这次口语迁移；阅读完成不会产生口语能力证据。"); }}>跳过这一步</button></div></div> : null}
      </section>
    </div>
  );
}
