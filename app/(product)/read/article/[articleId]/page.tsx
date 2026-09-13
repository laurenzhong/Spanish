import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getArticle } from "@/src/modules/content/application";
import { createRuntimeArticleRepository } from "@/src/modules/content/repositories";
import { getPrivateStory } from "@/src/modules/reading/application";
import { createDrizzleGeneratedArticleRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

import { ArticleReader } from "./article-reader";

type ArticlePageProps = Readonly<{
  params: Promise<{ articleId: string }>;
}>;

export const metadata: Metadata = { title: "阅读文章" };

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { articleId } = await params;
  const decodedId = decodeURIComponent(articleId);
  const result = await getArticle(createRuntimeArticleRepository(), decodedId);
  if (result.reason === "found" && result.article) return <ArticleReader article={result.article} />;
  if (process.env.DATABASE_URL) {
    const user = await getCurrentUser();
    if (user) {
      const generated = await getPrivateStory(createDrizzleGeneratedArticleRepository(getDatabase()), user.id, decodedId);
      if (generated) return <ArticleReader article={generated} />;
    }
  }
  notFound();
}
