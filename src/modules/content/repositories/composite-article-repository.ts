import { filterArticles, type ArticleCardProjection, type ArticleListQuery } from "../domain/article";
import type { ArticleRepository } from "./article-repository";

export class CompositeArticleRepository implements ArticleRepository {
  constructor(private readonly repositories: readonly ArticleRepository[]) {}

  async list(query: ArticleListQuery = {}) {
    const results = await Promise.all(this.repositories.map(async (repository) => {
      const articles: ArticleCardProjection[] = [];
      let cursor: string | undefined = "0";
      for (let page = 0; page < 100; page += 1) {
        const result = await repository.list({ ...query, cursor, pageSize: 24 });
        articles.push(...result.articles);
        if (!result.hasMore || !result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return articles;
    }));
    const unique = new Map<string, ArticleCardProjection>();
    for (const articles of results) {
      for (const article of articles) unique.set(article.id, article);
    }
    return filterArticles([...unique.values()], query);
  }

  async findById(id: string) {
    let sawUnpublished = false;
    for (const repository of this.repositories) {
      if (!repository.findById) continue;
      const result = await repository.findById(id);
      if (result.reason === "found") return result;
      if (result.reason === "unpublished") sawUnpublished = true;
    }
    return { article: null, reason: sawUnpublished ? "unpublished" as const : "not-found" as const };
  }
}
