import type { Metadata } from "next";
import { Suspense } from "react";

import { listMedia } from "@/src/modules/media/application";
import { createDrizzleMediaRepository } from "@/src/modules/media/repositories";
import { mediaListQuerySchema } from "@/src/modules/media/schemas";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

import { LearnLibrarySkeleton } from "./learn-library-skeleton";
import { LearnPageContent } from "./learn-page-content";

export const metadata: Metadata = {
  title: "学习",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page shell returns synchronously so the library skeleton can stream as
 * the first paint. Every runtime read (search params, session, database) is
 * deferred into the suspended child; awaiting any of it here would make the
 * whole route fall back to the `(product)` surface state instead.
 */
export default function LearnPage({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  return (
    <Suspense fallback={<LearnLibrarySkeleton />}>
      <LearnLibraryData searchParams={searchParams} />
    </Suspense>
  );
}

async function LearnLibraryData({ searchParams }: Readonly<{ searchParams: SearchParams }>) {
  const raw = await searchParams;
  const parsed = mediaListQuerySchema.safeParse({
    search: first(raw.search),
    kind: first(raw.kind),
    topic: first(raw.topic),
    region: first(raw.region),
    cefr: first(raw.cefr),
    duration: first(raw.duration),
    sort: first(raw.sort),
    cursor: first(raw.cursor),
    pageSize: 24,
  });
  const query = parsed.success ? parsed.data : mediaListQuerySchema.parse({ pageSize: 24 });
  if (!process.env.DATABASE_URL) {
    return <LearnPageContent query={query} result={{ items: [], nextCursor: null, hasMore: false }} unavailable />;
  }

  const user = await getCurrentUser();
  let result;
  let unavailable = false;
  try {
    // Let the database query finish. A cold serverless connection can take
    // longer than two seconds; treating that as an empty library hides real
    // published media and makes the page disagree with the media API.
    result = await listMedia(createDrizzleMediaRepository(getDatabase()), query, user?.id);
  } catch {
    result = { items: [], nextCursor: null, hasMore: false };
    unavailable = true;
  }
  return <LearnPageContent query={query} result={result} unavailable={unavailable} />;
}
