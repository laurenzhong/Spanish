import type { Metadata } from "next";

import { getArticles } from "@/src/modules/content/application";
import { createRuntimeArticleRepository } from "@/src/modules/content/repositories";
import { listPrivateStories, listReadingProgress, listSavedArticles } from "@/src/modules/reading";
import { createDrizzleGeneratedArticleRepository, createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

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
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const requestedPage = Number.isSafeInteger(parsedPage) ? Math.max(parsedPage, 1) : 1;
  const repository = createRuntimeArticleRepository();
  let savedArticleIds: readonly string[] | undefined;
  let initialReaderProgress: Record<string, { position: number; status: "in_progress" | "completed"; lastOpenedAt: string }> = {};
  let savedFilterAvailable = false;
  let initialGeneratedArticles: Awaited<ReturnType<typeof listPrivateStories>>["articles"] = [];
  const articleResultPromise = savedOnly ? null : getArticles(repository, {
    search,
    topic,
    cefr: cefr as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | undefined,
    minutes: minutes as "short" | "medium" | "long" | undefined,
    sort,
    savedOnly: false,
    pageSize: ARTICLE_PAGE_SIZE,
    cursor: String((requestedPage - 1) * ARTICLE_PAGE_SIZE),
  });
  // The Web Sites tab is intentionally an honest empty state and does not need
  // any user-specific database reads. Avoid blocking it on auth/DB round trips.
  if (process.env.DATABASE_URL && source !== "web") {
    try {
      const user = await getCurrentUser();
      if (user) {
        const database = getDatabase();
        const readingRepository = createDrizzleReadingRepository(database);
        const progressPromise = listReadingProgress(readingRepository, user.id);
        const savedPromise = savedOnly ? listSavedArticles(readingRepository, user.id) : null;
        const generatedPromise = savedOnly
          ? listPrivateStories(createDrizzleGeneratedArticleRepository(database), user.id)
          : null;
        const [progress, saved, generated] = await Promise.all([
          progressPromise,
          savedPromise,
          generatedPromise,
        ]);
        initialGeneratedArticles = generated?.articles ?? [];
        savedArticleIds = saved ?? undefined;
        initialReaderProgress = Object.fromEntries(progress.map((item) => [item.articleId, {
          position: item.position,
          status: item.status,
          lastOpenedAt: item.lastOpenedAt.toISOString(),
        }]));
        savedFilterAvailable = savedOnly && savedArticleIds !== undefined;
      }
    } catch {
      // The shelf still renders its local/offline fallback when private data is unavailable.
    }
  }
  const query = {
    search,
    topic,
    cefr: cefr as "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | undefined,
    minutes: minutes as "short" | "medium" | "long" | undefined,
    sort,
    savedOnly: savedOnly && savedFilterAvailable,
    savedArticleIds,
    pageSize: ARTICLE_PAGE_SIZE,
    cursor: String((requestedPage - 1) * ARTICLE_PAGE_SIZE),
  };
  let result = await (articleResultPromise ?? getArticles(repository, query));
  const totalPages = Math.max(Math.ceil(result.totalCount / ARTICLE_PAGE_SIZE), 1);
  const page = Math.min(requestedPage, totalPages);
  if (page !== requestedPage) {
    result = await getArticles(repository, { ...query, cursor: String((page - 1) * ARTICLE_PAGE_SIZE) });
  }

  return (
    <div className="page-stack read-page">
      <h1 className="sr-only">阅读</h1>
      <ReadShelf result={result} page={page} pageSize={ARTICLE_PAGE_SIZE} search={search ?? ""} topic={topic ?? ""} cefr={cefr ?? ""} minutes={minutes ?? ""} source={source} sort={sort} savedOnly={savedOnly} initialReaderProgress={initialReaderProgress} generatedArticles={initialGeneratedArticles} />
    </div>
  );
}
