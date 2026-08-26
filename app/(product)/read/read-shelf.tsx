"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

type ReadShelfProps = Readonly<{
  result: ArticleListResult;
  search: string;
  topic: string;
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

export function ReadShelf({ result, search, topic, savedOnly }: ReadShelfProps) {
  const [query, setQuery] = useState(search);
  const [continueArticle, setContinueArticle] = useState<ArticleCardProjection | null>(null);
  const [savedArticleIds, setSavedArticleIds] = useState<ReadonlySet<string> | null>(savedOnly ? null : new Set());
  const [readerStates, setReaderStates] = useState<Readonly<Record<string, StoredReaderState>>>({});
  const [savedLoadFailed, setSavedLoadFailed] = useState(false);
  const hasFilters = Boolean(search || topic || savedOnly);

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

  const visibleArticles = useMemo(
    () => savedOnly ? result.articles.filter((article) => savedArticleIds?.has(article.id)) : result.articles,
    [result.articles, savedArticleIds, savedOnly],
  );

  useEffect(() => {
    const nextStates = Object.fromEntries(
      visibleArticles.flatMap((article) => {
        const state = readStoredState(article.stableKey);
        return state ? [[article.stableKey, state] as const] : [];
      }),
    );
    queueMicrotask(() => setReaderStates(nextStates));
  }, [visibleArticles]);

  useEffect(() => {
    const candidates = visibleArticles
      .map((article) => ({ article, state: readStoredState(article.stableKey) }))
      .filter((entry): entry is { article: ArticleCardProjection; state: StoredReaderState } => Boolean(entry.state && entry.state.position > 0));
    candidates.sort((a, b) => (b.state.lastOpenedAt ?? "").localeCompare(a.state.lastOpenedAt ?? ""));
    queueMicrotask(() => setContinueArticle(candidates[0]?.article ?? null));
  }, [visibleArticles]);

  const resultLabel = useMemo(() => {
    if (savedOnly) return "已保存";
    if (search || topic) return "匹配文章";
    return "精选文章";
  }, [savedOnly, search, topic]);

  return (
    <div className="read-library">
      {continueArticle ? (
        <section className="read-continue read-continue--active" aria-labelledby="read-continue-title">
          <div className="read-continue__copy">
            <p className="eyebrow eyebrow--accent">继续阅读</p>
            <h2 id="read-continue-title">{continueArticle.title}</h2>
            <p>{continueArticle.sourceName} · {continueArticle.estimatedReadingMinutes} 分钟 · 从上次停下的地方继续</p>
          </div>
          <Link className="primary-link" href={`/read/article/${encodeURIComponent(continueArticle.id)}`}>继续阅读 <span aria-hidden="true">→</span></Link>
        </section>
      ) : null}

      <section className="read-library__toolbar" aria-label="文章筛选">
        <form className="read-search" method="get">
          <label htmlFor="read-search-input">搜索文章</label>
          <div className="read-search__field">
            <input id="read-search-input" name="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、主题或来源" />
            {topic ? <input type="hidden" name="topic" value={topic} /> : null}
            {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
            <button type="submit" aria-label="搜索文章"><span aria-hidden="true">⌕</span></button>
          </div>
        </form>
        <div className="read-library__toolbar-actions">
          <div className="read-filter-group" aria-label="文章视图">
            <Link className={!savedOnly && !topic ? "is-selected" : ""} href="/read">全部文章</Link>
            <Link className={savedOnly ? "is-selected" : ""} href="/read?saved=1">已保存</Link>
          </div>
          <label className="read-sort">
            <span>排序</span>
            <select aria-label="文章排序" defaultValue="recommended">
              <option value="recommended">推荐</option>
              <option value="newest">最新</option>
              <option value="shortest">最短</option>
            </select>
          </label>
        </div>
      </section>

      <section className="read-topics" aria-labelledby="read-topics-title">
        <div className="section-heading">
          <div><p className="eyebrow eyebrow--accent">按主题浏览</p><h2 id="read-topics-title">找到你现在关心的方向</h2></div>
          <span>{result.topics.length} 个主题</span>
        </div>
        <div className="read-topic-list">
          <Link className={!topic ? "is-selected" : ""} href={savedOnly ? "/read?saved=1" : "/read"}>全部</Link>
          {result.topics.map((value) => (
            <Link className={topic === value ? "is-selected" : ""} href={`/read?topic=${encodeURIComponent(value)}${savedOnly ? "&saved=1" : ""}`} key={value}>{topicLabel(value)}</Link>
          ))}
        </div>
      </section>

      <section className="read-results" aria-labelledby="read-results-title">
        <div className="section-heading"><div><p className="eyebrow eyebrow--accent">文章库</p><h2 id="read-results-title">{resultLabel}</h2></div><span>{visibleArticles.length} 篇</span></div>
        {visibleArticles.length > 0 ? (
          <div className="read-article-list">
            {visibleArticles.map((article) => <ArticleListItem article={article} readerState={readerStates[article.stableKey]} key={article.id} />)}
          </div>
        ) : (
          <div className="surface-state read-empty" role="status">
            <span className="surface-state__marker" aria-hidden="true">文</span>
            <h2>{savedOnly ? (savedLoadFailed ? "已保存文章暂时无法读取" : "还没有保存的文章") : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中"}</h2>
            <p>{savedOnly ? (savedLoadFailed ? "网络恢复或登录后可以重新读取你的个人保存。" : "打开一篇文章后，你可以保存文章、短语或高亮。") : hasFilters ? "换一个主题或搜索词试试，或者先回到今天的练习。" : "每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。"}</p>
            {hasFilters ? <Link className="text-link" href="/read">查看全部文章 <span aria-hidden="true">→</span></Link> : <Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link>}
          </div>
        )}
        {result.hasMore && result.nextCursor ? <Link className="secondary-action read-more" href={`/read?cursor=${result.nextCursor}`}>加载更多文章</Link> : null}
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
