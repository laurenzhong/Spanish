import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import "./vocabulary-shelf.css";

import {
  createDrizzleLexiconCorpusRepository,
  LexiconPagination,
  listFrequencyWords,
  ReadSectionNavigation,
  VocabularyShelfControls,
  type FrequencyWordItem,
} from "@/src/modules/lexicon-corpus";
import { VocabularyShelf, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { findCommonGlossaryEntry, normalizeGlossarySurface } from "@/src/modules/reading/domain/common-glossary";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "词汇" };

type VocabularyPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

/**
 * The single vocabulary shelf's contract: a search over the ranked reference
 * list plus paging through it.
 *
 * `?view=` is deliberately not read. The page used to be three views
 * (`study` / `frequency` / `lexicon`) selected by that parameter; it is now one
 * shelf, so the parameter can no longer select behaviour — an old bookmark or
 * link still resolves, to the same page everyone else sees. The lexicon-only
 * `intent` / `lemmaStatus` filters are gone with the server-side shelf for the
 * same reason: they would be silently ignored filters.
 */
const shelfQuerySchema = z.object({
  search: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().max(80).optional()),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

const SHELF_LOAD_TIMEOUT_MS = 20_000;
const SESSION_LOAD_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("SHELF_LOAD_TIMEOUT")), milliseconds); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

/**
 * One shelf row: the ranked reference word with our corpus facts, joined to the
 * reviewed glossary entry when the word has one.
 *
 * `markKey` stays the accent-folded headword — the identity the study shelf's
 * browser-local marks were stored under — so a mark made there still lands on
 * this word. Words without a reviewed entry keep the key of their own surface
 * and show the honest 「释义待补充」 placeholder rather than an invented meaning.
 */
function toShelfItem(item: FrequencyWordItem): VocabularyShelfItem {
  const entry = findCommonGlossaryEntry(item.word);
  return {
    id: item.id,
    markKey: entry ? normalizeGlossarySurface(entry.headword) : normalizeGlossarySurface(item.word),
    text: item.word,
    count: item.occurrenceCount,
    context: item.context,
    source: item.sourceTitle,
    glossary: entry ? {
      cefr: entry.cefr,
      partOfSpeech: entry.partOfSpeech,
      meanings: entry.meanings.map((meaning) => ({ meaning: meaning.meaning, usage: meaning.usage })),
      collocations: entry.collocations,
      examples: entry.examples,
      forms: entry.forms ?? [],
    } : null,
  };
}

export default async function VocabularyPage({ searchParams }: VocabularyPageProps) {
  const params = await searchParams;
  const parsed = shelfQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : shelfQuerySchema.parse({});
  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);

  let shelf: Awaited<ReturnType<typeof listFrequencyWords>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let shelfUnavailable = !databaseUrlConfigured;

  // The shelf itself never needs the session, but the local mark scope does.
  // Both start together and the session is capped, so a slow (or absent)
  // account lookup can neither delay the cold shelf nor fail the page.
  const [user, loaded] = await Promise.all([
    withTimeout(getCurrentUser(), SESSION_LOAD_TIMEOUT_MS).catch(() => null),
    (async () => {
      if (!databaseUrlConfigured) return null;
      try {
        return {
          ok: true as const,
          page: await withTimeout(
            listFrequencyWords(createDrizzleLexiconCorpusRepository(getDatabase()), { search: query.search, page: query.page, pageSize: query.pageSize }),
            SHELF_LOAD_TIMEOUT_MS,
          ),
        };
      } catch {
        // A configured database that cannot be read is an outage, not an empty
        // shelf: keep it distinguishable so the page says so instead of
        // claiming nothing matched.
        return { ok: false as const };
      }
    })(),
  ]);
  if (loaded) {
    if (loaded.ok) {
      shelf = loaded.page;
      shelfUnavailable = false;
    } else {
      shelfUnavailable = true;
    }
  }

  const items = shelf.items.map(toShelfItem);

  return <div className="page-stack read-page">
    <ReadSectionNavigation active="vocabulary" />
    <main className="lexicon-shelf">
      {/* Keep one page-level heading for assistive technology and the document
          outline; it stays visually hidden so the shelf starts directly with the
          search field and the word list. The section navigation already labels
          this page, and there is no second navigation to label a view. */}
      <h1 className="sr-only">词汇</h1>

      <VocabularyShelfControls query={{ search: query.search }} total={shelf.total} />
      <VocabularyShelf items={items} storageScope={user?.id ?? "anonymous"} page={shelf.page} pageSize={query.pageSize} total={shelf.total} ranked={!query.search} />

      {shelfUnavailable && !shelf.items.length ? <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>词汇表暂时不可用</h2><p>已发布内容仍然安全保留，请稍后刷新。</p></div> : null}
      {/* An empty result that never searched is an out-of-range page, not a
          failed search: a deep link past the shelf's end must say so. */}
      {!shelfUnavailable && !shelf.items.length && query.search ? <div className="lexicon-empty"><h2>没有匹配的词</h2><p>换一个搜索词，或把页码调回第一页。</p></div> : null}
      {!shelfUnavailable && !shelf.items.length && !query.search ? <div className="lexicon-empty"><h2>这一页在词架之外</h2><p>词架共 {shelf.total} 个内容词（每页 {query.pageSize} 个）。<Link href="/read/vocabulary">回到第 1 页</Link></p></div> : null}

      <LexiconPagination basePath="/read/vocabulary" page={shelf.page} pageSize={query.pageSize} total={shelf.total} query={{ search: query.search, pageSize: query.pageSize }} />
    </main>
  </div>;
}
