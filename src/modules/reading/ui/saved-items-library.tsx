"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useReadAloud } from "@/src/modules/providers/tts";
import { SlideableNavigation } from "@/src/shared/ui/slideable-navigation";
import type {
  SavedArticleItemResponse,
  SavedReadingItemResponse,
  SavedShelfItemResponse,
  SavedShelfItemType,
} from "../domain/saved-items";

type SavedItemsLibraryProps = Readonly<{
  items: readonly SavedShelfItemResponse[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  itemType?: SavedShelfItemType;
  unavailable?: boolean;
}>;

type LocalReaderState = {
  version?: unknown;
  contentHash?: unknown;
  savedPhrases?: unknown;
  highlights?: unknown;
  [key: string]: unknown;
};

const readerStoragePrefix = "reading-reader:v1:";

function hrefFor(query: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && String(value) !== "") params.set(key, String(value));
  });
  const serialized = params.toString();
  return serialized ? `/read/saved-items?${serialized}` : "/read/saved-items";
}

function typeLabel(itemType: SavedShelfItemType): string {
  if (itemType === "article") return "文章";
  return itemType === "highlight" ? "高亮" : "保存词语 / 短语";
}

function itemKey(item: SavedShelfItemResponse): string {
  return item.itemType === "article" ? item.articleId : item.id;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function renderContext(context: string | null, text: string) {
  if (!context) return <span className="saved-items-library__context-fallback">暂时没有保存时的上下文。</span>;
  const start = context.toLocaleLowerCase().indexOf(text.toLocaleLowerCase());
  if (start < 0) return context;
  const end = start + text.length;
  return <>{context.slice(0, start)}<mark>{context.slice(start, end)}</mark>{context.slice(end)}</>;
}

function escapeCsv(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function isSafeSourceUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function updateLocalReaderState(item: SavedReadingItemResponse): void {
  if (typeof window === "undefined") return;
  const key = `${readerStoragePrefix}${item.stableKey}`;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    const state = parsed as LocalReaderState;
    if (state.version !== item.version) return;
    const field = item.itemType === "highlight" ? "highlights" : "savedPhrases";
    const current = Array.isArray(state[field]) ? state[field] : [];
    const next = current.filter((value) => {
      if (!value || typeof value !== "object") return true;
      const row = value as { position?: unknown; text?: unknown };
      return row.position !== item.position || row.text !== item.text;
    });
    if (next.length === current.length) return;
    window.localStorage.setItem(key, JSON.stringify({ ...state, [field]: next }));
    window.dispatchEvent(new CustomEvent("sueno:reading-saved-item-removed", { detail: item }));
  } catch {
    // A private shelf remains usable when local storage is unavailable.
  }
}

export function SavedItemsLibrary({ items, total, page, pageSize, search, itemType, unavailable = false }: SavedItemsLibraryProps) {
  const [rows, setRows] = useState<readonly SavedShelfItemResponse[]>(items);
  const [totalCount, setTotalCount] = useState(total);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [busyDeleteId, setBusyDeleteId] = useState<string | null>(null);
  const [busySaveId, setBusySaveId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const speech = useReadAloud();
  const activeSpeakingId = speech.speakingId;
  const visibleNotice = speech.errorMessage || notice;

  const speak = useCallback((item: SavedReadingItemResponse) => {
    setNotice("");
    speech.speak(item.id, item.text, () => setNotice("当前浏览器不支持音频播放，词句仍可正常浏览。"));
  }, [speech]);

  const toggleSpeech = useCallback((item: SavedReadingItemResponse) => {
    if (speech.speakingId === item.id) speech.stop();
    else speak(item);
  }, [speak, speech]);

  const remove = useCallback(async (item: SavedReadingItemResponse) => {
    if (busyDeleteId) return;
    setBusyDeleteId(item.id);
    setNotice("");
    try {
      const response = await fetch(`/api/v1/read/saved-items/${encodeURIComponent(item.id)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("delete-failed");
      setRows((current) => current.filter((row) => row.itemType !== "article" && row.id !== item.id));
      setTotalCount((current) => Math.max(0, current - 1));
      setPendingDeleteId(null);
      updateLocalReaderState(item);
      setNotice("已从已保存词句中移除。");
    } catch {
      setNotice("暂时无法移除这条词句，请稍后再试。");
    } finally {
      setBusyDeleteId(null);
    }
  }, [busyDeleteId]);

  /** Unsaves a saved article. Public articles leave the shelf; private stories stay listed. */
  const unsaveArticle = useCallback(async (item: SavedArticleItemResponse) => {
    if (busySaveId) return;
    setBusySaveId(item.articleId);
    setNotice("");
    try {
      const response = await fetch("/api/v1/read/saved", {
        body: JSON.stringify({ articleId: item.articleId, saved: false }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("unsave-failed");
      if (item.origin === "public") {
        setRows((current) => current.filter((row) => !(row.itemType === "article" && row.articleId === item.articleId)));
        setTotalCount((current) => Math.max(0, current - 1));
      } else {
        setRows((current) => current.map((row) => row.itemType === "article" && row.articleId === item.articleId ? { ...row, saved: false } : row));
      }
      setNotice("已取消收藏。");
    } catch {
      setNotice("暂时无法取消收藏，请稍后再试。");
    } finally {
      setBusySaveId(null);
    }
  }, [busySaveId]);

  const deleteStory = useCallback(async (item: SavedArticleItemResponse) => {
    if (busyDeleteId) return;
    setBusyDeleteId(item.articleId);
    setNotice("");
    try {
      const response = await fetch(`/api/v1/read/generated-stories/${encodeURIComponent(item.articleId)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("delete-failed");
      setRows((current) => current.filter((row) => !(row.itemType === "article" && row.articleId === item.articleId)));
      setTotalCount((current) => Math.max(0, current - 1));
      setPendingDeleteId(null);
      setNotice("已删除这篇私人故事。");
    } catch {
      setNotice("暂时无法删除这篇私人故事，请稍后再试。");
    } finally {
      setBusyDeleteId(null);
    }
  }, [busyDeleteId]);

  const exportCurrentPage = useCallback(() => {
    if (!rows.length || typeof document === "undefined") return;
    const lines = [
      ["类型", "标题/词句", "来源", "上下文/说明", "时间"].map(escapeCsv).join(","),
      ...rows.map((item) => item.itemType === "article"
        ? [typeLabel(item.itemType), item.title, item.sourceName, item.origin === "generated" ? "私人 AI 故事" : "已收藏文章", item.createdAt].map(escapeCsv).join(",")
        : [typeLabel(item.itemType), item.text, `${item.title} · ${item.sourceName}`, item.context ?? "", item.createdAt].map(escapeCsv).join(",")),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "sueno-saved-reading-items.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("已导出当前页内容。");
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const previousHref = hrefFor({ search: search || undefined, itemType, pageSize, page: page - 1 });
  const nextHref = hrefFor({ search: search || undefined, itemType, pageSize, page: page + 1 });
  const filtered = Boolean(search || itemType);
  const tabs = useMemo(() => [
    { key: "all", label: "全部", href: hrefFor({ search: search || undefined, pageSize }), current: !itemType },
    { key: "article", label: "文章", href: hrefFor({ search: search || undefined, itemType: "article", pageSize }), current: itemType === "article" },
    { key: "phrase", label: "保存词语 / 短语", href: hrefFor({ search: search || undefined, itemType: "phrase", pageSize }), current: itemType === "phrase" },
    { key: "highlight", label: "高亮", href: hrefFor({ search: search || undefined, itemType: "highlight", pageSize }), current: itemType === "highlight" },
  ], [itemType, pageSize, search]);

  const emptyCopy = itemType === "article"
    ? ["还没有已保存的文章", "在文章列表点击收藏，或生成一篇私人故事，它们会出现在这里。"]
    : itemType === "phrase"
      ? ["还没有保存词语 / 短语", "在文章正文中点击词语，再选择“保存词语”，它们会出现在这里。"]
      : itemType === "highlight"
        ? ["还没有高亮", "在文章正文中选择句子并标记“高亮”，它们会出现在这里。"]
        : ["还没有已保存内容", "收藏文章、在正文中保存词语或高亮，或生成一篇私人故事，它们都会出现在这里。"];
  // A page past the end (items removed elsewhere, or the merged 全部 window)
  // must not claim the shelf is empty.
  const beyondLastPage = !rows.length && totalCount > 0;

  return <section className="saved-items-library" aria-label="已保存">
    <header className="saved-items-library__header">
      <div>
        <p className="saved-items-library__eyebrow">个人阅读书架</p>
        <h1>已保存</h1>
        <p className="page-lede">收藏的文章、私人 AI 故事，以及阅读中保存的词语、短语和高亮，都集中在这里。</p>
      </div>
      <p className="saved-items-library__boundary">这里是阅读整理，不会改变掌握度、可信度或口语能力。</p>
    </header>

    <SlideableNavigation
      className="saved-items-library__tabs"
      label="已保存内容类型"
      activeKey={tabs.find((tab) => tab.current)?.key}
      items={tabs}
      indicatorClassName="saved-items-library__indicator"
    />

    {unavailable ? <div className="saved-items-library--state" role="alert"><h2>已保存内容暂时不可用</h2><p>你的文章收藏和词句标注没有被删除。请稍后刷新，或先回到文章继续阅读。</p><button type="button" onClick={() => window.location.reload()}>重新载入</button></div> : <>
      <form className="saved-items-library__filters" action="/read/saved-items" method="get" role="search">
        <label className="saved-items-library__search"><span>搜索已保存内容</span><input name="search" defaultValue={search} maxLength={120} placeholder="搜索标题、来源或已保存词句" /></label>
        {itemType ? <input type="hidden" name="itemType" value={itemType} /> : null}
        <input type="hidden" name="pageSize" value={pageSize} />
        <button type="submit">搜索</button>
        {filtered ? <Link href={hrefFor({ pageSize })}>清除筛选</Link> : null}
        <button className="saved-items-library__export" type="button" onClick={exportCurrentPage} disabled={!rows.length}>导出当前页</button>
      </form>

      <div className="saved-items-library__summary" aria-live="polite"><span>共 {totalCount} 条</span>{search ? <span>搜索：{search}</span> : null}<span>最新在前</span></div>
      {visibleNotice ? <p className="saved-items-library__notice" role="status" aria-live="polite">{visibleNotice}</p> : null}

      {!rows.length ? <div className="saved-items-library__empty"><h2>{beyondLastPage ? "这一页没有内容" : search ? "没有匹配的已保存内容" : emptyCopy[0]}</h2><p>{beyondLastPage ? "内容可能已在别处移除，回到第一页重新查看。" : search ? "试试更短的搜索词，或切换到全部类型。" : emptyCopy[1]}</p>{beyondLastPage || filtered ? <Link className="primary-link" href={hrefFor({ pageSize })}>查看全部</Link> : <Link className="primary-link" href="/read">去文章里保存</Link>}</div> : <>
        <div className="saved-items-library__list">
          {rows.map((item) => item.itemType === "article"
            ? <SavedArticleCard
              item={item}
              key={itemKey(item)}
              busySave={busySaveId === item.articleId}
              busyDelete={busyDeleteId === item.articleId}
              pendingDelete={pendingDeleteId === itemKey(item)}
              onCancelDelete={() => setPendingDeleteId(null)}
              onRequestDelete={() => setPendingDeleteId(itemKey(item))}
              onUnsave={() => void unsaveArticle(item)}
              onDelete={() => void deleteStory(item)}
            />
            : <article className="saved-item-card" key={itemKey(item)}>
              <div className="saved-item-card__topline"><span className={`saved-item-card__badge saved-item-card__badge--${item.itemType}`}>{typeLabel(item.itemType)}</span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>
              <div className="saved-item-card__body">
                <div className="saved-item-card__text-row"><h2 lang="es">{item.text}</h2><button className="saved-item-card__speak" type="button" aria-label={activeSpeakingId === item.id ? `停止朗读 ${item.text}` : `朗读 ${item.text}`} onClick={() => toggleSpeech(item)}>{activeSpeakingId === item.id ? "停止" : "朗读"}</button></div>
                <p className="saved-item-card__context" lang="es">{renderContext(item.context, item.text)}</p>
                <div className="saved-item-card__source"><span>{item.title}</span><span>{item.sourceName}</span></div>
                <div className="saved-item-card__actions"><Link href={`/read/article/${encodeURIComponent(item.articleId)}#segment-${item.position}`}>回到原文 <span aria-hidden="true">↗</span></Link>{isSafeSourceUrl(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 <span aria-hidden="true">↗</span></a> : null}{pendingDeleteId === itemKey(item) ? <><button type="button" onClick={() => setPendingDeleteId(null)} disabled={busyDeleteId === item.id}>取消</button><button className="is-danger" type="button" onClick={() => void remove(item)} disabled={busyDeleteId === item.id}>{busyDeleteId === item.id ? "移除中…" : "确认移除"}</button></> : <button type="button" onClick={() => setPendingDeleteId(itemKey(item))}>移除</button>}</div>
              </div>
            </article>)}
        </div>
        {totalPages > 1 ? <nav className="saved-items-library__pagination" aria-label="已保存内容分页"><span>{page} / {totalPages}</span>{page > 1 ? <Link href={previousHref}>上一页</Link> : <span aria-disabled="true">上一页</span>}{page < totalPages ? <Link href={nextHref}>下一页</Link> : <span aria-disabled="true">下一页</span>}</nav> : null}
      </>}
    </>}
  </section>;
}

type SavedArticleCardProps = Readonly<{
  item: SavedArticleItemResponse;
  busySave: boolean;
  busyDelete: boolean;
  pendingDelete: boolean;
  onCancelDelete: () => void;
  onRequestDelete: () => void;
  onUnsave: () => void;
  onDelete: () => void;
}>;

function SavedArticleCard({ item, busySave, busyDelete, pendingDelete, onCancelDelete, onRequestDelete, onUnsave, onDelete }: SavedArticleCardProps) {
  const articleHref = `/read/article/${encodeURIComponent(item.articleId)}`;
  return <article className="saved-item-card saved-item-card--article">
    <div className="saved-item-card__topline">
      <span className={`saved-item-card__badge saved-item-card__badge--${item.origin === "generated" ? "generated" : "article"}`}>{item.origin === "generated" ? "私人 AI 故事" : "文章"}</span>
      <time dateTime={item.createdAt}>{item.saved ? "保存于 " : "创建于 "}{formatDate(item.createdAt)}</time>
    </div>
    <div className="saved-item-card__body">
      <div className="saved-item-card__text-row"><h2><Link href={articleHref} title={item.title}>{item.title}</Link></h2></div>
      <div className="saved-item-card__source"><span>{item.sourceName}</span><span>{item.saved ? "已收藏" : "未收藏"}</span></div>
      <div className="saved-item-card__actions">
        <Link href={articleHref}>开始阅读 <span aria-hidden="true">↗</span></Link>
        {isSafeSourceUrl(item.sourceUrl) ? <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">查看来源 <span aria-hidden="true">↗</span></a> : null}
        {item.saved ? <button type="button" aria-label={`取消收藏：${item.title}`} onClick={onUnsave} disabled={busySave}>{busySave ? "处理中…" : "取消收藏"}</button> : null}
        {item.origin === "generated" ? (pendingDelete
          ? <><button type="button" onClick={onCancelDelete} disabled={busyDelete}>取消</button><button className="is-danger" type="button" aria-label={`确认删除私人故事：${item.title}`} onClick={onDelete} disabled={busyDelete}>{busyDelete ? "删除中…" : "确认删除"}</button></>
          : <button type="button" aria-label={`删除私人故事：${item.title}`} onClick={onRequestDelete}>删除</button>) : null}
      </div>
    </div>
  </article>;
}
