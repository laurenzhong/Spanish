"use client";

import Link from "next/link";
import { useState } from "react";

import type { ArticleCardProjection, ArticleListResult } from "@/src/modules/content/domain";

type ReadShelfProps = Readonly<{
  result: ArticleListResult;
  search: string;
  topic: string;
  savedOnly: boolean;
}>;

function topicLabel(topic: string): string {
  return topic.replace(/^topic\./u, "").replaceAll("-", " ");
}

function formatLabel(format: ArticleCardProjection["format"]): string {
  return { news: "新闻", essay: "随笔", dialogue: "对话", guide: "指南", story: "故事" }[format];
}

export function ReadShelf({ result, search, topic, savedOnly }: ReadShelfProps) {
  const [query, setQuery] = useState(search);
  const hasFilters = Boolean(search || topic || savedOnly);
  return (
    <>
      <section className="read-toolbar" aria-label="文章筛选">
        <form className="read-search" method="get">
          <label htmlFor="read-search-input">搜索文章</label>
          <div className="read-search__field">
            <input id="read-search-input" name="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、主题或来源" />
            {topic ? <input type="hidden" name="topic" value={topic} /> : null}
            {savedOnly ? <input type="hidden" name="saved" value="1" /> : null}
            <button type="submit" aria-label="搜索文章"><span aria-hidden="true">⌕</span></button>
          </div>
        </form>
        <div className="read-filter-group" aria-label="文章视图">
          <Link className={!savedOnly && !topic ? "is-selected" : ""} href="/read">全部文章</Link>
          <Link className={savedOnly ? "is-selected" : ""} href="/read?saved=1">已保存</Link>
        </div>
      </section>

      <section className="read-topics" aria-labelledby="read-topics-title">
        <div className="section-heading">
          <div><p className="eyebrow eyebrow--accent">按主题</p><h2 id="read-topics-title">找到你现在关心的方向</h2></div>
          <span>{result.topics.length} 个主题</span>
        </div>
        <div className="read-topic-list">
          <Link className={!topic ? "is-selected" : ""} href={savedOnly ? "/read?saved=1" : "/read"}>全部</Link>
          {result.topics.map((value) => (
            <Link className={topic === value ? "is-selected" : ""} href={`/read?topic=${encodeURIComponent(value)}${savedOnly ? "&saved=1" : ""}`} key={value}>{topicLabel(value)}</Link>
          ))}
        </div>
      </section>

      <section className="read-continue" aria-labelledby="read-continue-title">
        <div><p className="eyebrow eyebrow--accent">继续阅读</p><h2 id="read-continue-title">从上次停下的地方接着看</h2></div>
        <p>你还没有进行中的文章。打开第一篇后，阅读断点会出现在这里。</p>
      </section>

      <section className="read-results" aria-labelledby="read-results-title">
        <div className="section-heading"><div><p className="eyebrow eyebrow--accent">文章库</p><h2 id="read-results-title">精选文章</h2></div><span>{result.articles.length} 篇</span></div>
        {result.articles.length > 0 ? (
          <div className="read-article-grid">
            {result.articles.map((article) => <ArticleCard article={article} key={article.id} />)}
          </div>
        ) : (
          <div className="surface-state read-empty" role="status">
            <span className="surface-state__marker" aria-hidden="true">文</span>
            <h2>{savedOnly ? "还没有保存的文章" : hasFilters ? "没有找到匹配的文章" : "可公开阅读的文章正在准备中"}</h2>
            <p>{savedOnly ? "保存功能会在阅读器开放后出现。" : hasFilters ? "换一个主题或搜索词试试，或者先回到今天的练习。" : "每篇文章都会经过来源、版权和语言审核；准备好后会出现在这里。"}</p>
            {hasFilters ? <Link className="text-link" href="/read">查看全部文章 <span aria-hidden="true">→</span></Link> : <Link className="text-link" href="/learn">回到今天 <span aria-hidden="true">→</span></Link>}
          </div>
        )}
        {result.hasMore && result.nextCursor ? <Link className="secondary-action read-more" href={`/read?cursor=${result.nextCursor}`}>加载更多文章</Link> : null}
      </section>
    </>
  );
}

function ArticleCard({ article }: Readonly<{ article: ArticleCardProjection }>) {
  return (
    <article className="read-article-card">
      <div className="read-article-card__meta"><span>{article.cefr}</span><span>{formatLabel(article.format)}</span><span>{article.estimatedReadingMinutes} 分钟</span></div>
      <h3><Link href={`/read/article/${encodeURIComponent(article.id)}`}>{article.title}</Link></h3>
      <p>{article.summary}</p>
      <div className="read-article-card__topics">{article.topics.map((topic) => <span key={topic}>{topicLabel(topic)}</span>)}</div>
      <footer><span>{article.sourceName}</span><span>{article.region}</span></footer>
    </article>
  );
}
