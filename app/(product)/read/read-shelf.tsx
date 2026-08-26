"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

type ReadSort = "hot" | "newest" | "shortest";
type ReadSource = "public" | "web";

type ReadShelfProps = Readonly<{
  result: ArticleListResult;
  search: string;
  topic: string;
  cefr: string;
  minutes: string;
  source: ReadSource;
  sort: ReadSort;
  savedOnly: boolean;
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

export function ReadShelf({ result, search, topic, cefr, minutes, source, sort, savedOnly }: ReadShelfProps) {
  const [query, setQuery] = useState(search);
  const [savedArticleIds, setSavedArticleIds] = useState<ReadonlySet<string> | null>(savedOnly ? null : new Set());
  const [readerStates, setReaderStates] = useState<Readonly<Record<string, StoredReaderState>>>({});
  const [savedLoadFailed, setSavedLoadFailed] = useState(false);
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const hasFilters = Boolean(search || topic || cefr || minutes);

  useEffect(() => {
    if (!savedOnly) return;
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
  }, [savedOnly]);

  const visibleArticles = useMemo(() => {
    if (source === "web") return [];
    const filtered = result.articles.filter((article) => {
      if (savedOnly && !savedArticleIds?.has(article.id)) return false;
      if (cefr && article.cefr !== cefr) return false;
      if (minutes === "short" && article.estimatedReadingMinutes > 5) return false;
      if (minutes === "medium" && (article.estimatedReadingMinutes < 6 || article.estimatedReadingMinutes > 10)) return false;
      if (minutes === "long" && article.estimatedReadingMinutes < 11) return false;
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (sort === "shortest") return left.estimatedReadingMinutes - right.estimatedReadingMinutes;
      if (sort === "newest") return (right.publicationDate ?? "").localeCompare(left.publicationDate ?? "");
      return 0;
    });
  }, [cefr, minutes, result.articles, savedArticleIds, savedOnly, sort, source]);

  useEffect(() => {
    const nextStates = Object.fromEntries(
      visibleArticles.flatMap((article) => {
        const state = readStoredState(article.stableKey);
        return state ? [[article.stableKey, state] as const] : [];
      }),
    );
    queueMicrotask(() => setReaderStates(nextStates));
  }, [visibleArticles]);

  const sourceLabel = source === "web" ? "Web Sites" : savedOnly ? "My Texts" : "Public Texts";
  const emptyHeading = source === "web"
    ? "Web Sites 暂未开放"
    : savedOnly
      ? savedLoadFailed ? "My Texts 暂时无法读取" : "My Texts 还是空的"
      : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中";
  const emptyDescription = source === "web"
    ? "外部网站保存和正文解析需要单独的来源许可，当前 Alpha 先保留入口。"
    : savedOnly
      ? savedLoadFailed ? "网络恢复或登录后可以重新读取你的个人保存。" : "打开一篇文章后，点击保存文章即可在这里继续阅读。"
      : hasFilters ? "换一个筛选条件试试，或者回到 Public Texts。" : "每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。";

  return (
    <div className="read-library">
      <nav className="read-library__source-tabs" aria-label="Reading sources">
        <Link className={source === "public" && !savedOnly ? "is-selected" : ""} href={withParams({ search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>Public Texts</Link>
        <Link className={savedOnly ? "is-selected" : ""} href={withParams({ saved: "1", search, sort: sort !== "hot" ? sort : undefined, topic, cefr, minutes })}>My Texts</Link>
        <Link className={source === "web" ? "is-selected" : ""} href={withParams({ source: "web", search, sort: sort !== "hot" ? sort : undefined })}>Web Sites</Link>
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
          <button className="read-tool-button" type="button" onClick={() => setToolNotice("Generate Story 当前仅保留入口；生成内容需要经过内容审核后才会进入文章库。")}>✣ <span>Generate Story</span></button>
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

      <section className="read-results" aria-labelledby="read-results-title">
        <div className="section-heading"><div><p className="eyebrow eyebrow--accent">Reading library</p><h2 id="read-results-title">{sourceLabel}</h2></div><span>{source === "web" || savedArticleIds === null ? "" : `${visibleArticles.length} 篇`}</span></div>
        {visibleArticles.length > 0 ? (
          <div className="read-article-list">
            {visibleArticles.map((article) => <ArticleListItem article={article} readerState={readerStates[article.stableKey]} key={article.id} />)}
          </div>
        ) : (
          <div className="surface-state read-empty" role="status">
            <span className="surface-state__marker" aria-hidden="true">文</span>
            <h2>{emptyHeading}</h2>
            <p>{emptyDescription}</p>
            {source === "web" ? <button className="text-link" type="button" onClick={() => setToolNotice("请先在文章阅读器中使用真实的来源保存入口。")}>了解来源保存</button> : hasFilters ? <Link className="text-link" href="/read">View Public Texts <span aria-hidden="true">→</span></Link> : null}
          </div>
        )}
        {result.hasMore && result.nextCursor && source === "public" ? <Link className="secondary-action read-more" href={withParams({ search, topic, cefr, minutes, sort: sort !== "hot" ? sort : undefined, cursor: result.nextCursor })}>Load more</Link> : null}
      </section>
    </div>
  );
}

function ArticleListItem({ article, readerState }: Readonly<{ article: ArticleCardProjection; readerState?: StoredReaderState }>) {
  return (
    <article className={`read-article-row read-article-row--${article.format}`}>
      <div className="read-article-row__type" aria-hidden="true"><span>{formatLabel(article.format)}</span><i /></div>
      <div className="read-article-row__body">
        <div className="read-article-row__heading">
          <div className="read-article-row__meta"><span>{article.sourceName}</span>{article.author ? <span>作者 {article.author}</span> : null}<span>{article.cefr} · {article.estimatedReadingMinutes} 分钟</span></div>
          <span className="read-article-row__state">{readingStatus(readerState)}</span>
        </div>
        <h3><Link href={`/read/article/${encodeURIComponent(article.id)}`}>{article.title}</Link></h3>
        <p>{article.summary}</p>
        <div className="read-article-row__rule" aria-hidden="true"><span /></div>
        <div className="read-article-row__footer">
          <div className="read-article-row__topics">{article.topics.map((value) => <span key={value}>{topicLabel(value)}</span>)}</div>
          <Link className="read-article-row__read-link" href={`/read/article/${encodeURIComponent(article.id)}`}>打开文章 <span aria-hidden="true">＋</span></Link>
        </div>
      </div>
      <Link className="read-article-row__action" href={`/read/article/${encodeURIComponent(article.id)}`} aria-label={`打开文章：${article.title}`} title={article.title}><span aria-hidden="true">→</span></Link>
    </article>
  );
}
