"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";
import type { GeneratedStoryCard } from "@/src/modules/reading/domain/generated-story";

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

export function ReadShelf({ result, page = 1, pageSize = 12, search, topic, cefr, minutes, source, sort, savedOnly, initialReaderProgress, generatedArticles = [] }: ReadShelfProps) {
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
    const publicArticles = savedOnly && !result.savedFilterAvailable ? result.articles.filter((article) => savedArticleIds?.has(article.id)) : result.articles;
    return savedOnly ? [...publicArticles, ...privateArticles] : publicArticles;
  }, [privateArticles, result.articles, result.savedFilterAvailable, savedArticleIds, savedOnly, source]);

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

  const emptyHeading = source === "web"
    ? "Web Sites 暂未开放"
    : savedOnly
      ? savedLoadFailed ? "My Texts 暂时无法读取" : "My Texts 还是空的"
      : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中";
  const emptyDescription = source === "web"
    ? "外部网站保存和正文解析需要单独的来源许可，当前 Alpha 先保留入口。"
    : savedOnly
      ? savedLoadFailed ? "网络恢复或登录后可以重新读取你的个人保存。" : "在文章卡片右侧点击五角星，即可把它加入这里。"
      : hasFilters ? "换一个筛选条件试试，或者回到 Public Texts。" : "每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。";

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
      setToolNotice(saved ? "已保存到 My Texts。" : "已从 My Texts 移除。");
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
    try {
      const response = await fetch(`/api/v1/read/generated-stories/${encodeURIComponent(articleId)}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) throw new Error("delete-unavailable");
      const stableKey = articleId.slice(0, articleId.lastIndexOf("@"));
      if (stableKey) window.localStorage.removeItem(`${readerStoragePrefix}${stableKey}`);
      setPrivateArticles((previous) => previous.filter((item) => item.id !== articleId));
      setToolNotice("文章已从 My Texts 删除。");
    } catch {
      setToolNotice("文章暂时无法删除，请稍后重试。");
    }
  }, []);

  return (
    <div className="read-library">
      <nav className="read-library__source-tabs" aria-label="Reading sources">
        <Link className={source === "public" && !savedOnly ? "is-selected" : ""} href={withParams({ search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>Public Texts</Link>
        <Link className={savedOnly ? "is-selected" : ""} href={withParams({ saved: "1", search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>My Texts</Link>
        <Link className={source === "web" ? "is-selected" : ""} href={withParams({ source: "web", search, sort: sort !== "hot" ? sort : undefined })}>Web Sites</Link>
        <span className="read-library__source-count">{source === "web" || savedArticleIds === null ? "" : `${savedOnly ? visibleArticles.length : result.totalCount} texts`}</span>
      </nav>

      <section className="read-library__toolbar" aria-label="Reading tools">
        <form className="read-search" method="get">
          <label htmlFor="read-search-input">Search by title or author</label>
          <div className="read-search__field">
            <input id="read-search-input" name="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title or author" />
            {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
            {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
            {topic ? <input type="hidden" name="topic" value={topic} /> : null}
            {cefr ? <input type="hidden" name="cefr" value={cefr} /> : null}
            {minutes ? <input type="hidden" name="minutes" value={minutes} /> : null}
            {sort !== "hot" ? <input type="hidden" name="sort" value={sort} /> : null}
            <button type="submit" aria-label="Search"><span aria-hidden="true">⌕</span></button>
          </div>
        </form>
        <div className="read-library__toolbar-actions">
          <Link className="read-tool-button" href="/read/generate">✣ <span>Generate Story</span></Link>
          <button className="read-tool-button" type="button" onClick={() => setToolNotice("Upload Text or Audio 当前仅保留入口；上传解析和版权检查将在后续 Alpha 增量开放。")}>↑ <span>Upload Text or Audio</span></button>
          <label className="read-sort">
            <span>Sort</span>
            <select aria-label="Sort articles" value={sort} onChange={(event) => { window.location.href = withParams({ source: source === "web" ? "web" : undefined, saved: savedOnly ? "1" : undefined, search, topic, cefr, minutes, sort: event.target.value }); }}>
              <option value="hot">Hot</option>
              <option value="newest">Newest</option>
              <option value="shortest">Shortest</option>
            </select>
          </label>
          <details className="read-filter-menu">
            <summary>Filters <span aria-hidden="true">⌄</span></summary>
            <form method="get" className="read-filter-menu__panel">
              {source === "web" ? <input type="hidden" name="source" value="web" /> : null}
              {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
              {search ? <input type="hidden" name="search" value={search} /> : null}
              {sort !== "hot" ? <input type="hidden" name="sort" value={sort} /> : null}
              <label><span>Topic</span><select name="topic" defaultValue={topic}><option value="">All topics</option>{result.topics.map((value) => <option value={value} key={value}>{topicLabel(value)}</option>)}</select></label>
              <label><span>Level</span><select name="cefr" defaultValue={cefr}><option value="">All levels</option>{["A1", "A2", "B1", "B2", "C1", "C2"].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label><span>Length</span><select name="minutes" defaultValue={minutes}><option value="">Any length</option><option value="short">Up to 5 min</option><option value="medium">6–10 min</option><option value="long">11+ min</option></select></label>
              <button className="secondary-action" type="submit">Apply filters</button>
            </form>
          </details>
        </div>
      </section>

      {toolNotice ? <aside className="read-library__notice" role="status">{toolNotice}<button type="button" onClick={() => setToolNotice(null)} aria-label="Dismiss notice">×</button></aside> : null}

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
            {source === "web" ? <button className="text-link" type="button" onClick={() => setToolNotice("请先在文章阅读器中使用真实的来源保存入口。")}>了解来源保存</button> : hasFilters ? <Link className="text-link" href="/read">View Public Texts <span aria-hidden="true">→</span></Link> : null}
          </div>
        )}
        {source === "public" && result.totalCount > 0 && (!savedOnly || result.savedFilterAvailable) ? <ArticlePagination page={page} pageSize={pageSize} totalCount={result.totalCount} search={search} topic={topic} cefr={cefr} minutes={minutes} sort={sort} savedOnly={savedOnly} /> : null}
      </section>
    </div>
  );
}

function ArticlePagination({ page, pageSize, totalCount, search, topic, cefr, minutes, sort, savedOnly }: Readonly<{ page: number; pageSize: number; totalCount: number; search: string; topic: string; cefr: string; minutes: string; sort: ReadSort; savedOnly: boolean }>) {
  const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
  const hrefFor = (targetPage: number) => withParams({ page: targetPage > 1 ? String(targetPage) : undefined, saved: savedOnly ? "1" : undefined, search, topic, cefr, minutes, sort: sort !== "hot" ? sort : undefined });
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1);
  return (
    <nav className="read-pagination" aria-label="Article pages">
      {page > 1 ? <Link className="read-pagination__arrow" href={hrefFor(page - 1)} aria-label="Previous page">← <span>Previous</span></Link> : <span className="read-pagination__arrow is-disabled" aria-disabled="true">← <span>Previous</span></span>}
      <div className="read-pagination__pages">
        {pageNumbers.map((pageNumber) => pageNumber === page
          ? <span className="read-pagination__page is-current" aria-current="page" key={pageNumber}>{pageNumber}</span>
          : <Link className="read-pagination__page" href={hrefFor(pageNumber)} key={pageNumber}>{pageNumber}</Link>)}
      </div>
      {page < totalPages ? <Link className="read-pagination__arrow" href={hrefFor(page + 1)} aria-label="Next page"><span>Next</span> →</Link> : <span className="read-pagination__arrow is-disabled" aria-disabled="true"><span>Next</span> →</span>}
    </nav>
  );
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
        <h3><Link href={`/read/article/${encodeURIComponent(article.id)}`}>{article.title}</Link></h3>
        <p>{article.summary}</p>
        <div className="read-article-row__rule" aria-hidden="true"><span /></div>
        <div className="read-article-row__footer">
          <div className="read-article-row__topics">{article.topics.map((value) => <span key={value}>{topicLabel(value)}</span>)}</div>
          <div className="read-article-row__footer-actions"><Link className="read-article-row__read-link" href={`/read/article/${encodeURIComponent(article.id)}`}>打开文章 <span aria-hidden="true">＋</span></Link>{article.origin === "generated" && onDeleteGenerated ? <button className="read-article-row__delete" type="button" onClick={() => onDeleteGenerated(article.id)}>删除</button> : null}</div>
        </div>
      </div>
      <button className={`read-article-row__save${isSaved ? " is-saved" : ""}`} type="button" aria-label={isSaved ? `从 My Texts 移除：${article.title}` : `保存到 My Texts：${article.title}`} title={isSaved ? "从 My Texts 移除" : "保存到 My Texts"} aria-pressed={isSaved} aria-busy={isSaving} disabled={isSaving} onClick={() => onToggleSaved(article.id, isSaved)}><span aria-hidden="true">{isSaved ? "★" : "☆"}</span></button>
    </article>
  );
}
