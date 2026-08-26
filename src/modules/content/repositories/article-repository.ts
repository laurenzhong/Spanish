import type { ArticleListQuery, ArticleListResult } from "../domain/article";

export type ArticleRepository = Readonly<{
  list(query?: ArticleListQuery): Promise<ArticleListResult>;
}>;
