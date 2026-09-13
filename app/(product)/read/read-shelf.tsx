"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";
import type { GeneratedStoryCard } from "@/src/modules/reading/domain/generated-story";

type ReadSort = "hot" | "newest" | "shortest";
type ReadSource = "public" | "web";

type ReadShelfProps = Readonly<{
  result: ArticleListResult;
  visibleCount?: number;
  search: string;
  topic: string;
  cefr: string;
  minutes: string;
  source: ReadSource;
  sort: ReadSort;
  savedOnly: boolean;
  initialReaderProgress?: Readonly<Record<string, ReaderProgressSummary>>;
  generatedArticles?: readonly GeneratedStoryCard[];
}>;

type ReaderProgressSummary = Readonly<{
  position: number;
  status: "in_progress" | "completed";
  lastOpenedAt: string;
}>;

type StoredReaderState = Readonly<{
  stableKey: string;
  version: number;
  contentHash: string;
  position: number;
  saved?: boolean;
  status?: "in_progress" | "completed";
  lastOpenedAt?: string;
}>;

const readerStoragePrefix = "reading-reader:v1:";

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

function TrashIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4.5h6V7m-8 0 1 12h8l1-12M10 10v6m4-6v6" /></svg>;
}

export function ReadShelf({ result, visibleCount = 12, search, topic, cefr, minutes, source, sort, savedOnly, initialReaderProgress, generatedArticles = [] }: ReadShelfProps) {
  const [query, setQuery] = useState(search);
  const [savedArticleIds, setSavedArticleIds] = useState<ReadonlySet<string> | null>(() => savedOnly
    ? result.savedFilterAvailable ? new Set(result.articles.map((article) => article.id)) : null
    : new Set());
  const [savingArticleIds, setSavingArticleIds] = useState<ReadonlySet<string>>(new Set());
  const [readerStates, setReaderStates] = useState<Readonly<Record<string, StoredReaderState>>>({});
  const [readerProgress] = useState<Readonly<Record<string, ReaderProgressSummary>>>(initialReaderProgress ?? {});
  const [savedLoadFailed, setSavedLoadFailed] = useState(false);
  const [privateArticles, setPrivateArticles] = useState<readonly GeneratedStoryCard[]>(generatedArticles);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<"filter" | "add" | null>(null);
  const toolbarActionsRef = useRef<HTMLDivElement>(null);
  const hasFilters = Boolean(search || topic || cefr || minutes);
  const router = useRouter();

  useEffect(() => {
    if (source === "web") return;
    let cancelled = false;
    void fetch("/api/v1/read/saved", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("saved-unavailable");
        const payload = (await response.json()) as { data?: { articleIds?: unknown } };
        const ids = payload.data?.articleIds;
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error("saved-invalid");
        if (!cancelled) setSavedArticleIds(new Set(ids));
      })
      .catch(() => {
        if (!cancelled) setSavedLoadFailed(true);
      });
    return () => { cancelled = true; };
  }, [savedOnly, source]);

  const visibleArticles = useMemo(() => {
    if (source === "web") return [];
    const publicArticles = savedOnly ? result.articles.filter((article) => savedArticleIds?.has(article.id)) : result.articles;
    return savedOnly ? [...publicArticles, ...privateArticles] : publicArticles;
  }, [privateArticles, result.articles, savedArticleIds, savedOnly, source]);
  const removedServerArticleCount = savedOnly && result.savedFilterAvailable && savedArticleIds !== null
    ? result.articles.filter((article) => !savedArticleIds.has(article.id)).length
    : 0;
  const displayedArticleCount = source === "web" || savedArticleIds === null
    ? null
    : savedOnly
      ? result.savedFilterAvailable ? Math.max(0, result.totalCount - removedServerArticleCount) + privateArticles.length : visibleArticles.length
      : result.totalCount;

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
    : savedOnly
      ? savedLoadFailed ? "我的文章暂时无法读取" : "还没有收藏文章"
      : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中";
  const emptyDescription = source === "web"
    ? "网站保存和正文解析需要来源许可，当前暂不提供。"
    : savedOnly
      ? savedLoadFailed ? "网络恢复或重新登录后再试。" : "收藏的文章和私人故事会显示在这里。"
      : hasFilters ? "调整搜索或筛选条件后再试。" : "审核通过后，文章会显示在这里。";

  const toggleSaved = useCallback(async (articleId: string, currentlySaved: boolean) => {
    if (savingArticleIds.has(articleId)) return;
    const nextSaved = !currentlySaved;
    setSavingArticleIds((previous) => new Set(previous).add(articleId));
    setSavedArticleIds((previous) => {
      const next = new Set(previous ?? []);
      if (nextSaved) next.add(articleId);
      else next.delete(articleId);
      return next;
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
      setSavedArticleIds((previous) => {
        const next = new Set(previous ?? []);
        if (saved) next.add(articleId);
        else next.delete(articleId);
        return next;
      });
      setToolNotice(saved ? "已收藏。" : "已取消收藏。");
    } catch {
      setSavedArticleIds((previous) => {
        const next = new Set(previous ?? []);
        if (currentlySaved) next.add(articleId);
        else next.delete(articleId);
        return next;
      });
      setToolNotice("保存状态暂时无法更新，请稍后重试。");
    } finally {
      setSavingArticleIds((previous) => {
        const next = new Set(previous);
        next.delete(articleId);
        return next;
      });
    }
  }, [router, savingArticleIds]);

  const deleteGenerated = useCallback(async (articleId: string) => {
    if (!window.confirm("删除这篇私人故事？删除后无法恢复。")) return;
    try {
      const response = await fetch(`/api/v1/read/generated-stories/${encodeURIComponent(articleId)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("delete-unavailable");
      const stableKey = articleId.slice(0, articleId.lastIndexOf("@"));
      if (stableKey) window.localStorage.removeItem(`${readerStoragePrefix}${stableKey}`);
      setPrivateArticles((previous) => previous.filter((item) => item.id !== articleId));
      setToolNotice("私人故事已删除。");
    } catch {
      setToolNotice("文章暂时无法删除，请稍后重试。");
    }
  }, []);

  return (
    <div className="read-library">
      <nav className="read-library__source-tabs" aria-label="文章来源">
        <Link className={source === "public" && !savedOnly ? "is-selected" : ""} href={withParams({ search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>公共文章</Link>
        <Link className={savedOnly ? "is-selected" : ""} href={withParams({ saved: "1", search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>我的文章</Link>
        <span className="read-library__source-count">{displayedArticleCount === null ? "— 篇" : `${displayedArticleCount} 篇`}</span>
      </nav>

      <section className="read-library__toolbar" aria-label="文章工具">
        <form className="read-search" method="get" role="search">
          <label htmlFor="read-search-input">搜索文章</label>
          <div className="read-search__field">
            <input id="read-search-input" name="search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、作者或主题" />
            {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
            {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
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
            <select aria-label="排序" value={sort} onChange={(event) => router.push(withParams({ source: source === "web" ? "web" : undefined, saved: savedOnly ? "1" : undefined, search, topic, cefr, minutes, sort: event.target.value }))}>
              <option value="hot">默认排序</option>
              <option value="newest">最新发布</option>
              <option value="shortest">用时最短</option>
            </select>
          </label>
          <details className="read-filter-menu" open={openMenu === "filter"}>
            <summary onClick={(event) => { event.preventDefault(); setOpenMenu((current) => current === "filter" ? null : "filter"); }}>筛选 <ChevronIcon /></summary>
            <form method="get" className="read-filter-menu__panel">
              {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
              {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
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
            </div>
          </details>
        </div>
      </section>

      {toolNotice ? <aside className="read-library__notice" role="status">{toolNotice}<button type="button" onClick={() => setToolNotice(null)} aria-label="关闭提示">×</button></aside> : null}

      <section className="read-results" aria-label="文章列表">
        {visibleArticles.length > 0 ? (
          <div className="read-article-list">
            {visibleArticles.map((article) => <ArticleListItem article={article} isSaved={article.origin === "generated" || savedArticleIds?.has(article.id) === true} isSaving={savingArticleIds.has(article.id)} onToggleSaved={toggleSaved} onDeleteGenerated={article.origin === "generated" ? deleteGenerated : undefined} readerState={readerStates[article.stableKey]} key={article.id} />)}
          </div>
        ) : (
          <div className="surface-state read-empty" role="status">
            <span className="surface-state__marker" aria-hidden="true">文</span>
            <h2>{emptyHeading}</h2>
            <p>{emptyDescription}</p>
            {hasFilters && source !== "web" ? <Link className="text-link" href="/read">清除筛选 <span aria-hidden="true">→</span></Link> : null}
          </div>
        )}
        {source === "public" && result.hasMore && (!savedOnly || result.savedFilterAvailable) ? <ShowMoreArticles visibleCount={visibleCount} totalCount={result.totalCount} search={search} topic={topic} cefr={cefr} minutes={minutes} sort={sort} savedOnly={savedOnly} /> : null}
      </section>
    </div>
  );
}

function ShowMoreArticles({ visibleCount, totalCount, search, topic, cefr, minutes, sort, savedOnly }: Readonly<{ visibleCount: number; totalCount: number; search: string; topic: string; cefr: string; minutes: string; sort: ReadSort; savedOnly: boolean }>) {
  const nextVisible = Math.min(Math.max(visibleCount, 12) + 12, totalCount);
  const href = withParams({ visible: String(nextVisible), saved: savedOnly ? "1" : undefined, search, topic, cefr, minutes, sort: sort !== "hot" ? sort : undefined });
  return <div className="read-show-more"><Link href={href}>显示更多</Link></div>;
}

function ArticleListItem({ article, isSaved, isSaving, onToggleSaved, onDeleteGenerated, readerState }: Readonly<{ article: ArticleCardProjection; isSaved: boolean; isSaving: boolean; onToggleSaved: (articleId: string, currentlySaved: boolean) => void; onDeleteGenerated?: (articleId: string) => void; readerState?: StoredReaderState }>) {
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
      {article.origin === "generated" && onDeleteGenerated
        ? <button className="read-article-row__save read-article-row__delete" type="button" aria-label={`删除私人故事：${article.title}`} onClick={() => onDeleteGenerated(article.id)}><TrashIcon /></button>
        : <button className={`read-article-row__save${isSaved ? " is-saved" : ""}`} type="button" aria-label={isSaved ? `取消收藏：${article.title}` : `收藏文章：${article.title}`} title={isSaved ? "取消收藏" : "收藏文章"} aria-pressed={isSaved} aria-busy={isSaving} disabled={isSaving} onClick={() => onToggleSaved(article.id, isSaved)}><BookmarkIcon filled={isSaved} /></button>}
    </article>
  );
}
