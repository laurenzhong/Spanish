"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

type ReadSort = "hot" | "newest" | "shortest";
type ReadSource = "public" | "web";

type ReadShelfProps = Readonly<{
  result: ArticleListResult;
  page?: number;
  pageSize?: number;
  search: string;
  topic: string;
  cefr: string;
  minutes: string;
  source: ReadSource;
  sort: ReadSort;
}>;

type ReaderProgressSummary = Readonly<{
  position: number;
  status: "in_progress" | "completed";
  lastOpenedAt: string;
}>;

type ReaderProgressMap = Readonly<Record<string, ReaderProgressSummary>>;

type StoredReaderState = Readonly<{
  stableKey: string;
  version: number;
  contentHash: string;
  position: number;
  saved?: boolean;
  status?: "in_progress" | "completed";
  lastOpenedAt?: string;
}>;

type SavedArticleState = Readonly<{
  contextKey: string;
  ids: ReadonlySet<string> | null;
}>;

type SavedArticleIdsRequest = Promise<ReadonlySet<string>>;

const readerStoragePrefix = "reading-reader:v1:";

async function fetchSavedArticleIds(): SavedArticleIdsRequest {
  const response = await fetch("/api/v1/read/saved", { credentials: "same-origin" });
  if (!response.ok) throw new Error("saved-unavailable");
  const payload = (await response.json()) as { data?: { articleIds?: unknown } };
  const ids = payload.data?.articleIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("saved-invalid");
  return new Set(ids);
}

function isReaderProgressSummary(value: unknown): value is ReaderProgressSummary {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReaderProgressSummary>;
  return typeof candidate.position === "number"
    && typeof candidate.lastOpenedAt === "string"
    && (candidate.status === "in_progress" || candidate.status === "completed");
}

/**
 * The reader's own progress, keyed by article id.
 *
 * This is a separate request on purpose: it is per-user decoration for the
 * cards, and reading it during the server render added a second remote database
 * round trip (~800 ms measured) before the public library could paint. The
 * shelf renders first and applies these labels when they arrive; a failure only
 * costs the cross-device state, because `readStoredState` still supplies this
 * device's state.
 */
async function fetchReaderProgress(): Promise<ReaderProgressMap> {
  const response = await fetch("/api/v1/read/progress", { credentials: "same-origin" });
  if (!response.ok) throw new Error("progress-unavailable");
  const payload = (await response.json()) as { data?: { progress?: unknown } };
  const rows = payload.data?.progress;
  if (!Array.isArray(rows)) throw new Error("progress-invalid");
  return Object.fromEntries(rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const { articleId } = row as { articleId?: unknown };
    return typeof articleId === "string" && isReaderProgressSummary(row) ? [[articleId, row] as const] : [];
  }));
}

function topicLabel(topic: string): string {
  return topic.replace(/^topic\./u, "").replaceAll("-", " ");
}

function formatLabel(format: ArticleCardProjection["format"]): string {
  return { news: "新闻", essay: "随笔", dialogue: "对话", guide: "指南", story: "故事" }[format];
}

function readingStatus(state: StoredReaderState | undefined): "未开始" | "阅读中" | "已读" {
  if (!state || state.position <= 0) return "未开始";
  return state.status === "completed" ? "已读" : "阅读中";
}

function readStoredState(stableKey: string): StoredReaderState | null {
  try {
    const raw = window.localStorage.getItem(`${readerStoragePrefix}${stableKey}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<StoredReaderState>;
    return typeof state.stableKey === "string" && typeof state.version === "number" && typeof state.contentHash === "string" && typeof state.position === "number"
      ? state as StoredReaderState
      : null;
  } catch {
    return null;
  }
}

function withParams(params: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const serialized = query.toString();
  return serialized ? `/read?${serialized}` : "/read";
}

function SearchIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>;
}

function ChevronIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m8 10 4 4 4-4" /></svg>;
}

function BookmarkIcon({ filled }: Readonly<{ filled: boolean }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6.5 4.5h11v15l-5.5-3.2-5.5 3.2z" fill={filled ? "currentColor" : "none"} /></svg>;
}

function PaginationArrowIcon({ direction }: Readonly<{ direction: "previous" | "next" }>) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d={direction === "previous" ? "m14.5 7-5 5 5 5" : "m9.5 7 5 5-5 5"} /></svg>;
}

type PaginationItem = number | "ellipsis-start" | "ellipsis-end";

function getPaginationItems(page: number, totalPages: number): readonly PaginationItem[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages]);
  if (page <= 3) {
    [2, 3, 4].forEach((value) => pages.add(value));
  } else if (page >= totalPages - 2) {
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((value) => pages.add(value));
  } else {
    [page - 1, page, page + 1].forEach((value) => pages.add(value));
  }
  const sortedPages = [...pages].sort((a, b) => a - b);
  return sortedPages.flatMap<PaginationItem>((pageNumber, index) => {
    const previousPage = sortedPages[index - 1];
    if (previousPage && pageNumber - previousPage > 1) {
      return [index === 1 ? "ellipsis-start" : "ellipsis-end", pageNumber];
    }
    return [pageNumber];
  });
}

function getMobilePageNumbers(page: number, totalPages: number): ReadonlySet<number> {
  if (totalPages <= 5) return new Set(Array.from({ length: totalPages }, (_, index) => index + 1));
  if (page <= 3) return new Set([1, 2, 3, totalPages]);
  if (page >= totalPages - 2) return new Set([1, totalPages - 2, totalPages - 1, totalPages]);
  return new Set([1, page, totalPages]);
}

/**
 * The public article library. Personal content is deliberately absent here:
 * saved articles, saved words/phrases, highlights and private AI stories all
 * live on `/read/saved-items`, reached from `已保存` in the reading
 * navigation. `?source=web` keeps its honest empty state for older links.
 */
export function ReadShelf({ result, page = 1, pageSize = 12, search, topic, cefr, minutes, source, sort }: ReadShelfProps) {
  const [query, setQuery] = useState(search);
  const savedContextKey = source;
  const [savedArticleState, setSavedArticleState] = useState<SavedArticleState>(() => ({ contextKey: savedContextKey, ids: null }));
  const [savingArticleIds, setSavingArticleIds] = useState<ReadonlySet<string>>(new Set());
  const [readerStates, setReaderStates] = useState<Readonly<Record<string, StoredReaderState>>>({});
  const [readerProgress, setReaderProgress] = useState<ReaderProgressMap>({});
  const [savedLoadFailed, setSavedLoadFailed] = useState(false);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<"filter" | "add" | null>(null);
  const toolbarActionsRef = useRef<HTMLDivElement>(null);
  const hasFilters = Boolean(search || topic || cefr || minutes);
  const router = useRouter();

  const savedArticleIds = savedArticleState.contextKey === savedContextKey ? savedArticleState.ids : null;
  const readsPrivateState = source !== "web";

  useEffect(() => {
    if (!readsPrivateState) return;
    let cancelled = false;
    void fetchSavedArticleIds()
      .then((ids) => {
        if (cancelled) return;
        setSavedLoadFailed(false);
        setSavedArticleState({ contextKey: savedContextKey, ids });
      })
      .catch(() => { if (!cancelled) setSavedLoadFailed(true); });
    return () => { cancelled = true; };
  }, [savedContextKey, readsPrivateState]);

  useEffect(() => {
    // The Web Sites tab renders no articles, so it needs no reader state.
    if (!readsPrivateState) return;
    let cancelled = false;
    void fetchReaderProgress()
      .then((progress) => { if (!cancelled) setReaderProgress(progress); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [readsPrivateState]);

  const visibleArticles = useMemo(() => source === "web" ? [] : result.articles, [result.articles, source]);

  useEffect(() => {
    const nextStates = Object.fromEntries(
      visibleArticles.flatMap((article) => {
        const state = readStoredState(article.stableKey);
        if (state) return [[article.stableKey, state] as const];
        const summary = readerProgress[article.id];
        return summary ? [[article.stableKey, { ...summary, stableKey: article.stableKey, version: article.version, contentHash: "", position: summary.position } as StoredReaderState] as const] : [];
      }),
    );
    queueMicrotask(() => setReaderStates(nextStates));
  }, [readerProgress, visibleArticles]);

  useEffect(() => {
    if (!toolNotice) return;
    const timeout = window.setTimeout(() => setToolNotice(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [toolNotice]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && toolbarActionsRef.current?.contains(event.target)) return;
      setOpenMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const menu = openMenu;
      setOpenMenu(null);
      toolbarActionsRef.current?.querySelector<HTMLElement>(`.read-${menu}-menu summary`)?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  const emptyHeading = source === "web"
    ? "外部网站暂未开放"
    : savedLoadFailed && !visibleArticles.length
      ? "文章暂时无法读取"
      : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中";
  const emptyDescription = source === "web"
    ? "网站保存和正文解析需要来源许可，当前暂不提供。"
    : savedLoadFailed && !visibleArticles.length
      ? "网络恢复或重新登录后再试。"
      : hasFilters ? "调整搜索或筛选条件后再试。" : "审核通过后，文章会显示在这里。";

  const toggleSaved = useCallback(async (articleId: string, currentlySaved: boolean) => {
    if (savingArticleIds.has(articleId)) return;
    const nextSaved = !currentlySaved;
    setSavingArticleIds((previous) => new Set(previous).add(articleId));
    // Optimistic flip; the server response below is authoritative.
    setSavedArticleState((previous) => {
      const next = new Set(previous.contextKey === savedContextKey ? previous.ids ?? [] : []);
      if (nextSaved) next.add(articleId);
      else next.delete(articleId);
      return { contextKey: savedContextKey, ids: next };
    });
    try {
      const response = await fetch("/api/v1/read/saved", {
        body: JSON.stringify({ articleId, saved: nextSaved }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) throw new Error("save-unavailable");
      const payload = (await response.json()) as { data?: { saved?: unknown } };
      const saved = payload.data?.saved;
      if (typeof saved !== "boolean") throw new Error("save-invalid");
      setSavedArticleState((previous) => {
        const next = new Set(previous.contextKey === savedContextKey ? previous.ids ?? [] : []);
        if (saved) next.add(articleId);
        else next.delete(articleId);
        return { contextKey: savedContextKey, ids: next };
      });
      setToolNotice(saved ? "已收藏。" : "已取消收藏。");
    } catch {
      // Roll the optimistic flip back to the state before this attempt.
      setSavedArticleState((previous) => {
        const next = new Set(previous.contextKey === savedContextKey ? previous.ids ?? [] : []);
        if (currentlySaved) next.add(articleId);
        else next.delete(articleId);
        return { contextKey: savedContextKey, ids: next };
      });
      setToolNotice("保存状态暂时无法更新，请稍后重试。");
    } finally {
      setSavingArticleIds((previous) => {
        const next = new Set(previous);
        next.delete(articleId);
        return next;
      });
    }
  }, [router, savedContextKey, savingArticleIds]);

  return (
    <div className="read-library">
      <section className="read-library__toolbar" aria-label="文章工具">
        <form className="read-search" method="get" role="search">
          <label htmlFor="read-search-input">搜索文章</label>
          <div className="read-search__field">
            <input id="read-search-input" name="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或主题" />
            {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
            {topic ? <input type="hidden" name="topic" value={topic} /> : null}
            {cefr ? <input type="hidden" name="cefr" value={cefr} /> : null}
            {minutes ? <input type="hidden" name="minutes" value={minutes} /> : null}
            {sort !== "hot" ? <input type="hidden" name="sort" value={sort} /> : null}
            <button type="submit" aria-label="搜索"><SearchIcon /></button>
          </div>
        </form>
        <div className="read-library__toolbar-actions" ref={toolbarActionsRef}>
          <label className="read-sort">
            <span>排序</span>
            <select aria-label="排序" value={sort} onChange={(event) => router.push(withParams({ source: source === "web" ? "web" : undefined, search, topic, cefr, minutes, sort: event.target.value }))}>
              <option value="hot">默认排序</option>
              <option value="newest">最新发布</option>
              <option value="shortest">用时最短</option>
            </select>
          </label>
          <details className="read-filter-menu" open={openMenu === "filter"}>
            <summary onClick={(event) => { event.preventDefault(); setOpenMenu((current) => current === "filter" ? null : "filter"); }}>筛选 <ChevronIcon /></summary>
            <form method="get" className="read-filter-menu__panel">
              {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
              {search ? <input type="hidden" name="search" value={search} /> : null}
              {sort !== "hot" ? <input type="hidden" name="sort" value={sort} /> : null}
              <label><span>主题</span><select name="topic" defaultValue={topic}><option value="">全部主题</option>{result.topics.map((value) => <option value={value} key={value}>{topicLabel(value)}</option>)}</select></label>
              <label><span>难度</span><select name="cefr" defaultValue={cefr}><option value="">全部难度</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label><span>篇幅</span><select name="minutes" defaultValue={minutes}><option value="">不限篇幅</option><option value="short">5 分钟内</option><option value="medium">6–10 分钟</option><option value="long">11 分钟以上</option></select></label>
              <button className="secondary-action" type="submit">应用筛选</button>
            </form>
          </details>
          <details className="read-add-menu" open={openMenu === "add"}>
            <summary onClick={(event) => { event.preventDefault(); setOpenMenu((current) => current === "add" ? null : "add"); }}>添加内容 <ChevronIcon /></summary>
            <div className="read-add-menu__panel">
              <Link href="/read/generate">生成私人故事</Link>
              <Link href="/read/saved-items">查看已保存</Link>
            </div>
          </details>
        </div>
      </section>

      {toolNotice ? <aside className="read-library__notice" role="status">{toolNotice}<button type="button" onClick={() => setToolNotice(null)} aria-label="关闭提示">×</button></aside> : null}

      <section className="read-results" aria-label="文章列表">
        {visibleArticles.length > 0 ? (
          <div className="read-article-list">
            {visibleArticles.map((article) => <ArticleListItem article={article} isSaved={savedArticleIds?.has(article.id) === true} isSaving={savingArticleIds.has(article.id)} onToggleSaved={toggleSaved} readerState={readerStates[article.stableKey]} key={article.id} />)}
          </div>
        ) : (
          <div className="surface-state read-empty" role="status">
            <span className="surface-state__marker" aria-hidden="true">文</span>
            <h2>{emptyHeading}</h2>
            <p>{emptyDescription}</p>
            {hasFilters && source !== "web" ? <Link className="text-link" href="/read">清除筛选 <span aria-hidden="true">→</span></Link> : null}
          </div>
        )}
        {source === "public" && result.totalCount > pageSize ? <ArticlePagination page={page} pageSize={pageSize} totalCount={result.totalCount} search={search} topic={topic} cefr={cefr} minutes={minutes} sort={sort} /> : null}
      </section>
    </div>
  );
}

function ArticlePagination({ page, pageSize, totalCount, search, topic, cefr, minutes, sort }: Readonly<{ page: number; pageSize: number; totalCount: number; search: string; topic: string; cefr: string; minutes: string; sort: ReadSort }>) {
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
  const pageItems = getPaginationItems(page, totalPages);
  const mobilePageNumbers = getMobilePageNumbers(page, totalPages);
  const hrefFor = (targetPage: number) => withParams({ page: targetPage > 1 ? String(targetPage) : undefined, search, topic, cefr, minutes, sort: sort !== "hot" ? sort : undefined });
  return (
    <nav className="read-pagination" aria-label="文章分页">
      {page > 1
        ? <Link className="read-pagination__arrow" href={hrefFor(page - 1)} aria-label="上一页"><PaginationArrowIcon direction="previous" /><span>上一页</span></Link>
        : <span className="read-pagination__arrow is-disabled" aria-label="上一页" aria-disabled="true"><PaginationArrowIcon direction="previous" /><span>上一页</span></span>}
      <div className="read-pagination__pages">
        {pageItems.map((item) => typeof item === "number"
          ? item === page
            ? <span className="read-pagination__page is-current" aria-current="page" aria-label={`第 ${item} 页，当前页`} key={item}>{item}</span>
            : <Link className={`read-pagination__page${mobilePageNumbers.has(item) ? "" : " is-mobile-hidden"}`} href={hrefFor(item)} aria-label={`第 ${item} 页`} key={item}>{item}</Link>
          : <span className="read-pagination__ellipsis" aria-hidden="true" key={item}>…</span>)}
      </div>
      {page < totalPages
        ? <Link className="read-pagination__arrow" href={hrefFor(page + 1)} aria-label="下一页"><span>下一页</span><PaginationArrowIcon direction="next" /></Link>
        : <span className="read-pagination__arrow is-disabled" aria-label="下一页" aria-disabled="true"><span>下一页</span><PaginationArrowIcon direction="next" /></span>}
    </nav>
  );
}

function ArticleListItem({ article, isSaved, isSaving, onToggleSaved, readerState }: Readonly<{ article: ArticleCardProjection; isSaved: boolean; isSaving: boolean; onToggleSaved: (articleId: string, currentlySaved: boolean) => void; readerState?: StoredReaderState }>) {
  return (
    <article className={`read-article-row read-article-row--${article.format}`}>
      <div className="read-article-row__type" aria-hidden="true"><span>{formatLabel(article.format)}</span><i /></div>
      <div className="read-article-row__body">
        <div className="read-article-row__heading">
          <div className="read-article-row__meta"><span>{article.sourceName}</span>{article.origin === "generated" ? <span className="read-article-row__draft">AI draft</span> : null}{article.author ? <span>作者 {article.author}</span> : null}<span>{article.cefr} · {article.estimatedReadingMinutes} 分钟</span></div>
          <span className="read-article-row__state">{readingStatus(readerState)}</span>
        </div>
        <h3><Link className="read-article-row__main-link" href={`/read/article/${encodeURIComponent(article.id)}`} title={article.title}>{article.title}</Link></h3>
        <div className="read-article-row__rule" aria-hidden="true"><span /></div>
        <div className="read-article-row__footer"><div className="read-article-row__topics">{article.topics.map((value) => <span key={value}>{topicLabel(value)}</span>)}</div></div>
      </div>
      <button className={`read-article-row__save${isSaved ? " is-saved" : ""}`} type="button" aria-label={isSaved ? `取消收藏：${article.title}` : `收藏文章：${article.title}`} title={isSaved ? "取消收藏" : "收藏文章"} aria-pressed={isSaved} aria-busy={isSaving} disabled={isSaving} onClick={() => onToggleSaved(article.id, isSaved)}><BookmarkIcon filled={isSaved} /></button>
    </article>
  );
}
