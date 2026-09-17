import type { Metadata } from "next";

import { createDrizzleLexiconCorpusRepository, LexiconPagination, listVocabulary, VocabularyLibrary, ReadSectionNavigation, vocabularyQuerySchema, VocabularyShelfControls } from "@/src/modules/lexicon-corpus";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "词汇" };

type VocabularyPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function VocabularyPage({ searchParams }: VocabularyPageProps) {
  const parsed = vocabularyQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : vocabularyQuerySchema.parse({});
  let result: Awaited<ReturnType<typeof listVocabulary>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let unavailable = false;
  if (process.env.DATABASE_URL) {
    try { const user = await getCurrentUser(); result = await listVocabulary(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, query); } catch { unavailable = true; }
  }
  const filtered = Boolean(query.search || query.intent || query.lemmaStatus);
  const resultKey = [query.search, query.intent, query.lemmaStatus, query.page, query.pageSize].join(":");
  return <div className="page-stack read-page"><ReadSectionNavigation active="vocabulary" /><main className="lexicon-shelf"><header className="lexicon-shelf__header"><div><h1>词汇</h1><p className="page-lede">把在文章、视频和播客里遇到的词，连同它出现的上下文整理起来。</p></div><p>学习状态只用于整理，不会改变掌握度或可信度。</p></header><VocabularyShelfControls query={query} total={result.total} /><VocabularyLibrary key={resultKey} filtered={filtered} items={result.items} total={result.total} unavailable={unavailable} /><LexiconPagination basePath="/read/vocabulary" page={result.page} pageSize={result.pageSize} total={result.total} query={{ search: query.search, intent: query.intent, lemmaStatus: query.lemmaStatus, pageSize: query.pageSize }} /></main></div>;
}
