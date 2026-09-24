import { getDatabase } from "@/src/shared/db/client";
import type { ArticleListQuery, ArticleListResult } from "../domain/article";

import type { ArticleRepository } from "./article-repository";
import { BundleArticleRepository } from "./bundle-article-repository";
import { createDrizzleArticleRepository } from "./drizzle-article-repository";

const ARTICLE_CACHE_TTL_MS = 10 * 60 * 1_000;

type CachedArticleList = Readonly<{
  expiresAt: number;
  result: ArticleListResult;
}>;

const runtimeState = globalThis as typeof globalThis & {
  spanishArticleListCache?: Map<string, CachedArticleList>;
  spanishArticleListInFlight?: Map<string, Promise<ArticleListResult>>;
};

const articleListCache = runtimeState.spanishArticleListCache ??= new Map();
const articleListInFlight = runtimeState.spanishArticleListInFlight ??= new Map();

function cacheKey(query: ArticleListQuery): string {
  return JSON.stringify(query);
}

function createPersistentArticleRepository(databaseRepository: ArticleRepository): ArticleRepository {
  return {
    async list(query = {}) {
      const key = cacheKey(query);
      const cacheable = !query.savedOnly;
      const cached = cacheable ? articleListCache.get(key) : undefined;
      if (cached && cached.expiresAt > Date.now()) return cached.result;
      if (!cacheable) return databaseRepository.list(query);
      const inFlight = articleListInFlight.get(key);
      if (inFlight) return inFlight;

      const request = databaseRepository.list(query)
        .then((result) => {
          articleListCache.set(key, { expiresAt: Date.now() + ARTICLE_CACHE_TTL_MS, result });
          return result;
        })
        .catch((error) => {
          const stale = articleListCache.get(key);
          if (stale && stale.expiresAt > Date.now()) return stale.result;
          throw error;
        })
        .finally(() => {
          articleListInFlight.delete(key);
        });
      articleListInFlight.set(key, request);
      return request;
    },
    async findById(id) {
      if (!databaseRepository.findById) return { article: null, reason: "not-found" };
      return databaseRepository.findById(id);
    },
  };
}

export function createRuntimeArticleRepository(): ArticleRepository {
  const bundle = new BundleArticleRepository();
  if (!process.env.DATABASE_URL) return bundle;
  // A configured database is authoritative. A stale successful DB result is
  // safer than silently replacing it with the 105-item local bundle.
  return createPersistentArticleRepository(createDrizzleArticleRepository(getDatabase()));
}
