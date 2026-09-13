import { getDatabase } from "@/src/shared/db/client";

import type { ArticleRepository } from "./article-repository";
import { BundleArticleRepository } from "./bundle-article-repository";
import { CompositeArticleRepository } from "./composite-article-repository";
import { createDrizzleArticleRepository } from "./drizzle-article-repository";

export function createRuntimeArticleRepository(): ArticleRepository {
  const bundle = new BundleArticleRepository();
  if (!process.env.DATABASE_URL) return bundle;
  return new CompositeArticleRepository([bundle, createDrizzleArticleRepository(getDatabase())]);
}
