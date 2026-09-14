import type { Metadata } from "next";

import { createDrizzleLexiconCorpusRepository, listPhrases, PhraseLibrary, ReadSectionNavigation } from "@/src/modules/lexicon-corpus";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "短语" };

export default async function PhrasesPage() {
  let items = [] as Awaited<ReturnType<typeof listPhrases>>["items"];
  if (process.env.DATABASE_URL) {
    try { const user = await getCurrentUser(); items = (await listPhrases(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, { page: 1, pageSize: 24 })).items; } catch { /* honest empty state */ }
  }
  return <div className="page-stack read-page"><ReadSectionNavigation active="phrases" /><main><h1>短语</h1><p className="page-lede">正式表达、自然变体和实际语用会在同一处保留。</p><PhraseLibrary items={items} /></main></div>;
}
