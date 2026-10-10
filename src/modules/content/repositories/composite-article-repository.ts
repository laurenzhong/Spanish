import { filterArticles, type ArticleListQuery } from "../domain/article";
import type { ArticleRepository } from "./article-repository";

const ARTICLE_SOURCE_TIMEOUT_MS = 60_000;

async function listWithFallback(repository: ArticleRepository, query: ArticleListQuery, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      repository.list(query),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("ARTICLE_SOURCE_TIMEOUT")), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function findWithFallback(repository: ArticleRepository, id: string, timeoutMs: number) {
  if (!repository.findById) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      repository.findById(id),
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class CompositeArticleRepository implements ArticleRepository {
  constructor(
    private readonly repositories: readonly ArticleRepository[],
    private readonly sourceTimeoutMs = ARTICLE_SOURCE_TIMEOUT_MS,
  ) {}

  async list(query: ArticleListQuery = {}) {
    const results = await Promise.all(this.repositories.map(async (repository) => {
      return listWithFallback(repository, query, this.sourceTimeoutMs);
    }));
    const available = results.filter((result): result is NonNullable<typeof result> => result !== null);
    if (available.length === 0) return filterArticles([], query);

    // The persisted source is the authoritative projection when it is
    // available. The bundle remains a complete offline fallback, while the
    // smaller source page is never allowed to overwrite a larger DB result.
    const primary = available.reduce((current, candidate) =>
      candidate.totalCount > current.totalCount ? candidate : current,
    );
    const topics = [...new Set(available.flatMap((result) => result.topics))].sort();
    return { ...primary, topics };
  }

  async findById(id: string) {
    let sawUnpublished = false;
    for (const repository of this.repositories) {
      const result = await findWithFallback(repository, id, this.sourceTimeoutMs);
      if (!result) continue;
      if (result.reason === "found") return result;
      if (result.reason === "unpublished") sawUnpublished = true;
    }
    return { article: null, reason: sawUnpublished ? "unpublished" as const : "not-found" as const };
  }
}
