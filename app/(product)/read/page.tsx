import type { Metadata } from "next";

import { getArticles } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";

import { ReadShelf } from "./read-shelf";

export const metadata: Metadata = { title: "阅读" };

type ReadPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

type ReadSort = "hot" | "newest" | "shortest";
const ARTICLE_PAGE_SIZE = 12;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ReadPage({ searchParams }: ReadPageProps) {
  const params = await searchParams;
  const search = first(params.search)?.trim() || undefined;
  const topic = first(params.topic)?.trim() || undefined;
  const savedOnly = first(params.saved) === "1";
  const source = first(params.source) === "web" ? "web" : "public";
  const cefr = first(params.cefr)?.trim() || undefined;
  const minutes = first(params.minutes)?.trim() || undefined;
  const sortParam = first(params.sort);
  const sort: ReadSort = sortParam === "newest" || sortParam === "shortest" ? sortParam : "hot";
  const requestedPage = Math.max(Number.parseInt(first(params.page) ?? "1", 10) || 1, 1);
  const repository = new BundleArticleRepository();
  const query = {
    search,
    topic,
    cefr: cefr as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | undefined,
    minutes: minutes as "short" | "medium" | "long" | undefined,
    sort,
    savedOnly: false,
    pageSize: ARTICLE_PAGE_SIZE,
    cursor: String((requestedPage - 1) * ARTICLE_PAGE_SIZE),
  };
  let result = await getArticles(repository, query);
  const totalPages = Math.max(Math.ceil(result.totalCount / ARTICLE_PAGE_SIZE), 1);
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) {
    result = await getArticles(repository, { ...query, cursor: String((page - 1) * ARTICLE_PAGE_SIZE) });
  }

  return (
    <div className="page-stack read-page">
      <h1 className="sr-only">阅读</h1>
      <ReadShelf result={result} page={page} pageSize={ARTICLE_PAGE_SIZE} search={search ?? ""} topic={topic ?? ""} cefr={cefr ?? ""} minutes={minutes ?? ""} source={source} sort={sort} savedOnly={savedOnly} />
    </div>
  );
}
