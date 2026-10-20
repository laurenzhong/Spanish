import { getArticles } from "@/src/modules/content/application";
import { createRuntimeArticleRepository } from "@/src/modules/content/repositories";

import { ReadShelf } from "./read-shelf";
import { ReadShelfUnavailable } from "./read-shelf-unavailable";
import { ARTICLE_PAGE_SIZE } from "./shelf-constants";

type ReadSort = "hot" | "newest" | "shortest";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The public article library.
 *
 * This is the only part of `/read` that waits on data, so the page keeps it
 * behind its own `<Suspense>` boundary: the reading navigation is part of the
 * static shell and paints before this resolves.
 *
 * Everything here is public catalogue data. Per-user decoration (reading
 * progress, saved state) is fetched by the client shelf after paint; reading it
 * here measured ~800 ms of extra first-content delay because it is a second,
 * sequential round trip to a remote database.
 */
export async function ReadShelfData({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
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
  let result: Awaited<ReturnType<typeof getArticles>>;
  let page = requestedPage;
  try {
    const repository = createRuntimeArticleRepository();
    result = await getArticles(repository, query);
    const totalPages = Math.max(Math.ceil(result.totalCount / ARTICLE_PAGE_SIZE), 1);
    page = Math.min(requestedPage, totalPages);
    if (page !== requestedPage) {
      result = await getArticles(repository, { ...query, cursor: String((page - 1) * ARTICLE_PAGE_SIZE) });
    }
  } catch {
    // A failed database read is not an empty catalogue. Leave the URL intact
    // so an explicit refresh retries the same filters and requested page.
    return <ReadShelfUnavailable />;
  }

  return (
    <ReadShelf
      result={result}
      page={page}
      pageSize={ARTICLE_PAGE_SIZE}
      search={search ?? ""}
      topic={topic ?? ""}
      cefr={cefr ?? ""}
      minutes={minutes ?? ""}
      source={source}
      sort={sort}
    />
  );
}
