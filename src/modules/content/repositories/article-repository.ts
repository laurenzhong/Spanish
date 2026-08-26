import type { ArticleListQuery, ArticleListResult, ArticleLookupResult } from "../domain/article";

export type ArticleRepository = Readonly<{
  list(query?: ArticleListQuery): Promise<ArticleListResult>;
  findById?(id: string): Promise<ArticleLookupResult>;
}>;
