import type { ArticleLookupResult } from "../domain/article";
import type { ArticleRepository } from "../repositories/article-repository";

export async function getArticle(repository: ArticleRepository, id: string): Promise<ArticleLookupResult> {
  if (!repository.findById) return { article: null, reason: "not-found" };
  return repository.findById(id.trim().slice(0, 240));
}
