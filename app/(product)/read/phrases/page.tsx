import type { Metadata } from "next";
import { Suspense } from "react";

import { PhraseShelfSkeleton } from "./phrase-shelf-skeleton";

import { PhraseShelfData } from "./phrase-shelf-data";

export const metadata: Metadata = { title: "短语" };

type PhrasesPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

/**
 * The page renders synchronously: the reading navigation and the shelf header
 * are the shell, and only the shelf data waits behind its own Suspense
 * boundary. Switching to this tab therefore paints the tab and its heading
 * immediately instead of holding the whole tab on a remote read.
 */
export default function PhrasesPage({ searchParams }: PhrasesPageProps) {
  return (
    <main className="lexicon-shelf">
      <header className="lexicon-shelf__header">
        <div>
          <h1>短语</h1>
          <p className="page-lede">从真实文章、视频和播客中浏览语料片段与已审核短语。</p>
        </div>
        <p>浏览、保存和筛选不会形成口语证据。</p>
      </header>
      <Suspense fallback={<PhraseShelfSkeleton />}>
        <PhraseShelfData searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
