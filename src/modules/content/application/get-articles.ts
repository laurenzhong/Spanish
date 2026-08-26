import type { ArticleListQuery, ArticleListResult } from "../domain/article";
import type { ArticleRepository } from "../repositories/article-repository";

export async function getArticles(
  repository: ArticleRepository,
  query: ArticleListQuery = {},
): Promise<ArticleListResult> {
  return repository.list({
    ...query,
    search: query.search?.trim().slice(0, 120),
    topic: query.topic?.trim().slice(0, 120),
    pageSize: Math.min(Math.max(query.pageSize ?? 12, 1), 24),
  });
}
