import bundle from "@/content/bundles/alpha-core-v1.json";

import { validateContentBundle } from "../import";
import type { ContentBundle } from "../schemas";
import { filterArticles, projectPublicArticle, type ArticleListQuery } from "../domain/article";
import type { ArticleRepository } from "./article-repository";

const validatedBundle = validateContentBundle(bundle) as ContentBundle;

export class BundleArticleRepository implements ArticleRepository {
  constructor(private readonly source: ContentBundle = validatedBundle) {}

  async list(query: ArticleListQuery = {}) {
    const publicArticles = this.source.articles
      .map(projectPublicArticle)
      .filter((article): article is NonNullable<typeof article> => article !== null);
    return filterArticles(publicArticles, query);
  }
}
