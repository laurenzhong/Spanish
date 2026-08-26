import bundle from "@/content/bundles/alpha-core-v1.json";
import publicTextsBundle from "@/content/bundles/readlang-public-v1.json";

import { validateContentBundle } from "../import";
import type { ContentBundle } from "../schemas";
import { filterArticles, parseArticleId, projectArticleReader, projectPublicArticle, type ArticleListQuery, type ArticleLookupResult } from "../domain/article";
import type { ArticleRepository } from "./article-repository";

const validatedBundle = validateContentBundle({
  ...bundle,
  articles: [...bundle.articles, ...publicTextsBundle.articles],
  reviews: [...bundle.reviews, ...publicTextsBundle.reviews],
}) as ContentBundle;

export class BundleArticleRepository implements ArticleRepository {
  constructor(private readonly source: ContentBundle = validatedBundle) {}

  async list(query: ArticleListQuery = {}) {
    const publicArticles = this.source.articles
      .map(projectPublicArticle)
      .filter((article): article is NonNullable<typeof article> => article !== null);
    return filterArticles(publicArticles, query);
  }

  async findById(id: string): Promise<ArticleLookupResult> {
    const parsed = parseArticleId(id);
    if (!parsed) return { article: null, reason: "not-found" };
    const raw = this.source.articles.find(
      (article) => article.stableKey === parsed.stableKey && article.version === parsed.version,
    );
    if (!raw) return { article: null, reason: "not-found" };
    const article = projectArticleReader(raw);
    return article ? { article, reason: "found" } : { article: null, reason: "unpublished" };
  }
}
