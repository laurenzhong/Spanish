import type { ArticleListQuery, ArticleListResult } from "../domain/article";
import type { ArticleRepository } from "../repositories/article-repository";

const ARTICLE_LIST_CACHE_TTL_MS = 15_000;
const ARTICLE_LIST_CACHE_MAX_ENTRIES = 64;
type CacheEntry = Readonly<{ expiresAt: number; result?: ArticleListResult; pending?: Promise<ArticleListResult> }>;
const articleListCache = new Map<string, CacheEntry>();

function cacheKey(query: ArticleListQuery): string {
  return JSON.stringify(query);
}

export async function getArticles(
  repository: ArticleRepository,
  query: ArticleListQuery = {},
): Promise<ArticleListResult> {
  const normalizedQuery = {
    ...query,
    search: query.search?.trim().slice(0, 120),
    topic: query.topic?.trim().slice(0, 120),
    pageSize: Math.min(Math.max(query.pageSize ?? 12, 1), 24),
  };
  const key = cacheKey(normalizedQuery);
  const now = Date.now();
  const cached = articleListCache.get(key);
  if (cached?.result && cached.expiresAt > now) return cached.result;
  if (cached?.pending) return cached.pending;

  const pending = repository.list(normalizedQuery);
  articleListCache.set(key, { expiresAt: now + ARTICLE_LIST_CACHE_TTL_MS, pending });
  void pending.then((result) => {
    articleListCache.set(key, { expiresAt: Date.now() + ARTICLE_LIST_CACHE_TTL_MS, result });
    while (articleListCache.size > ARTICLE_LIST_CACHE_MAX_ENTRIES) {
      articleListCache.delete(articleListCache.keys().next().value!);
    }
  }, () => {
    if (articleListCache.get(key)?.pending === pending) articleListCache.delete(key);
  });
  return pending;
}
