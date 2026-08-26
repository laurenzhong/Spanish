import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getArticle } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";

import { ArticleReader } from "./article-reader";

type ArticlePageProps = Readonly<{
  params: Promise<{ articleId: string }>;
}>;

export const metadata: Metadata = { title: "阅读文章" };

export default async function ArticlePage({ params }: ArticlePageProps) {
  const { articleId } = await params;
  const result = await getArticle(new BundleArticleRepository(), decodeURIComponent(articleId));
  if (result.reason !== "found" || !result.article) notFound();
  return <ArticleReader article={result.article} />;
}
