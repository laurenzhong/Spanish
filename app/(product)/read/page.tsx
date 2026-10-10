import type { Metadata } from "next";

import { getArticles } from "@/src/modules/content/application";
import { createRuntimeArticleRepository } from "@/src/modules/content/repositories";
import { listReadingProgress } from "@/src/modules/reading";
import { createDrizzleReadingRepository } from "@/src/modules/reading/repositories";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { ReadSectionNavigation } from "@/src/modules/lexicon-corpus";

import { ReadShelf } from "./read-shelf";

export const metadata: Metadata = { title: "阅读" };

type ReadPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

type ReadSort = "hot" | "newest" | "shortest";
const ARTICLE_PAGE_SIZE = 12;
// Reading progress only decorates the shelf's cards. A slow projection must not
// hold the public article library open.
const PRIVATE_READ_DATA_TIMEOUT_MS = 800;

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("PRIVATE_READ_DATA_TIMEOUT")), milliseconds); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The public article library only. Saved articles, saved words/phrases,
 * highlights and private AI stories are owned by `/read/saved-items`.
 */
export default async function ReadPage({ searchParams }: ReadPageProps) {
  const params = await searchParams;
  const search = first(params.search)?.trim() || undefined;
  const topic = first(params.topic)?.trim() || undefined;
  const source = first(params.source) === "web" ? "web" : "public";
  const cefr = first(params.cefr)?.trim() || undefined;
  const minutes = first(params.minutes)?.trim() || undefined;
  const sortParam = first(params.sort);
  const sort: ReadSort = sortParam === "newest" || sortParam === "shortest" ? sortParam : "hot";
  const parsedPage = Number.parseInt(first(params.page) ?? "1", 10);
  const requestedPage = Number.isSafeInteger(parsedPage) ? Math.max(parsedPage, 1) : 1;
  const repository = createRuntimeArticleRepository();
  let initialReaderProgress: Record<string, { position: number; status: "in_progress" | "completed"; lastOpenedAt: string }> = {};

  // The Web Sites tab is intentionally an honest empty state and does not need
  // any user-specific database reads. Avoid blocking it on auth/DB round trips.
  if (process.env.DATABASE_URL && source !== "web") {
    try {
      initialReaderProgress = await withTimeout((async () => {
        const user = await getCurrentUser();
        if (!user) return {};
        const progress = await listReadingProgress(createDrizzleReadingRepository(getDatabase()), user.id);
        return Object.fromEntries(progress.map((item) => [item.articleId, {
          position: item.position,
          status: item.status,
          lastOpenedAt: item.lastOpenedAt.toISOString(),
        }]));
      })(), PRIVATE_READ_DATA_TIMEOUT_MS);
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
      <ReadSectionNavigation active="articles" />
      <ReadShelf result={result} page={page} pageSize={ARTICLE_PAGE_SIZE} search={search ?? ""} topic={topic ?? ""} cefr={cefr ?? ""} minutes={minutes ?? ""} source={source} sort={sort} initialReaderProgress={initialReaderProgress} />
    </div>
  );
}
