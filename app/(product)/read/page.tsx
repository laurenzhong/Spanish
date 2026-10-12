import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadShelfData } from "./read-shelf-data";
import { ReadShelfSkeleton } from "./read-shelf-skeleton";

export const metadata: Metadata = { title: "阅读" };

type ReadPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

/**
 * The public article library only. Saved articles, saved words/phrases,
 * highlights and private AI stories are owned by `/read/saved-items`.
 *
 * This page does not await anything: the heading and the reading navigation are
 * the static shell, and only the shelf waits on data behind its own Suspense
 * boundary. That keeps the tabs on screen at their real size while the list
 * loads, instead of replacing the whole page with a full-page placeholder, and
 * it keeps per-user reads out of the render path (they belong to the client
 * shelf, see `read-shelf.tsx`).
 */
export default function ReadPage({ searchParams }: ReadPageProps) {
  return (
    <>
      <h1 className="sr-only">阅读</h1>
      <Suspense fallback={<ReadShelfSkeleton />}>
        <ReadShelfData searchParams={searchParams} />
      </Suspense>
    </>
  );
}
