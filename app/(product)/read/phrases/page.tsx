import type { Metadata } from "next";
import { Suspense } from "react";

import { ReadSectionNavigation } from "@/src/modules/lexicon-corpus";
import { RouteLoading } from "@/src/shared/ui/route-loading";

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
    <div className="page-stack read-page">
      <ReadSectionNavigation active="phrases" />
      <main className="lexicon-shelf">
        <header className="lexicon-shelf__header">
          <div>
            <h1>短语</h1>
            <p className="page-lede">正式表达、自然变体和实际语用会在同一处保留。</p>
          </div>
          <p>浏览、保存和筛选不会形成口语证据。</p>
        </header>
        <Suspense fallback={<RouteLoading />}>
          <PhraseShelfData searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}
