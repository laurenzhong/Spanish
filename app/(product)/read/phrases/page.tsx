import type { Metadata } from "next";

import { createDrizzleLexiconCorpusRepository, LexiconPagination, listPhrases, PhraseLibrary, phraseQuerySchema, PhraseShelfControls, ReadSectionNavigation } from "@/src/modules/lexicon-corpus";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "短语" };

type PhrasesPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function PhrasesPage({ searchParams }: PhrasesPageProps) {
  const parsed = phraseQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : phraseQuerySchema.parse({});
  let result: Awaited<ReturnType<typeof listPhrases>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let unavailable = false;
  if (process.env.DATABASE_URL) {
    try { const user = await getCurrentUser(); result = await listPhrases(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, query); } catch { unavailable = true; }
  }
  const filtered = Boolean(query.search || query.intent || query.pragmaticPurpose || query.register || query.region || query.cefr);
  const resultKey = [query.search, query.intent, query.pragmaticPurpose, query.register, query.region, query.cefr, query.page, query.pageSize].join(":");
  return <div className="page-stack read-page"><ReadSectionNavigation active="phrases" /><main className="lexicon-shelf"><header className="lexicon-shelf__header"><div><h1>短语</h1><p className="page-lede">正式表达、自然变体和实际语用会在同一处保留。</p></div><p>浏览、保存和筛选不会形成口语证据。</p></header><PhraseShelfControls query={query} total={result.total} /><PhraseLibrary key={resultKey} filtered={filtered} items={result.items} total={result.total} unavailable={unavailable} /><LexiconPagination basePath="/read/phrases" page={result.page} pageSize={result.pageSize} total={result.total} query={{ search: query.search, intent: query.intent, pragmaticPurpose: query.pragmaticPurpose, register: query.register, region: query.region, cefr: query.cefr, pageSize: query.pageSize }} /></main></div>;
}
