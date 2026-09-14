import type { Metadata } from "next";

import { createDrizzleLexiconCorpusRepository, listVocabulary, VocabularyLibrary, ReadSectionNavigation } from "@/src/modules/lexicon-corpus";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "词汇" };

export default async function VocabularyPage() {
  let items = [] as Awaited<ReturnType<typeof listVocabulary>>["items"];
  if (process.env.DATABASE_URL) {
    try { const user = await getCurrentUser(); items = (await listVocabulary(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, { page: 1, pageSize: 24 })).items; } catch { /* honest empty state */ }
  }
  return <div className="page-stack read-page"><ReadSectionNavigation active="vocabulary" /><main><h1>词汇</h1><p className="page-lede">把在文章、视频和播客里遇到的词，连同它出现的上下文整理起来。</p><VocabularyLibrary items={items} /></main></div>;
}
