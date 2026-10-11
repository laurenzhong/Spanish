import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import "./vocabulary-shelf.css";

import {
  createDrizzleLexiconCorpusRepository,
  listFrequencyWords,
  ReadSectionNavigation,
  VocabularyShelfControls,
  type FrequencyWordItem,
} from "@/src/modules/lexicon-corpus";
// Deep import, like `@/src/modules/reading/domain/common-glossary` below: the
// domain module owns the reference list's size, which is the shelf's capacity.
import { contentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { VocabularyShelf, type VocabularyShelfGlossary } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { VocabularyShelfList, type VocabularyShelfItem } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf-list";
import { bandAnchorId, groupRanks, rankBandStart, type VocabularyRankBand } from "@/src/modules/lexicon-corpus/ui/vocabulary-rank";
import { findCommonGlossaryEntry, normalizeGlossarySurface } from "@/src/modules/reading/domain/common-glossary";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

export const metadata: Metadata = { title: "词汇" };

type VocabularyPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

/**
 * The shelf is one page now, so its only query is the reader's search.
 *
 * `?view=` is deliberately not read: the page used to be three views selected
 * by that parameter, and it no longer has any, so the parameter cannot select
 * behaviour — an old bookmark still resolves, to the page everyone else sees.
 *
 * `?page=` / `?pageSize=` are read only to be *converted*: paging is gone, and a
 * deep link that used to point at page 42 must not silently land at the top of
 * an 8,000-word page. It is redirected to the band fragment that holds the rank
 * it asked for (`?page=42&pageSize=24` → `#vocabulary-band-901`). With a search
 * active there is no shelf rank to convert to, so the parameters are dropped and
 * the search is kept.
 */
const shelfQuerySchema = z.object({
  search: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.string().trim().max(80).optional()),
});

const legacyPagingSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

const DEFAULT_PAGE_SIZE = 24;

function legacyPagingTarget(params: Record<string, string | string[] | undefined>, search: string | undefined): string | null {
  const paging = legacyPagingSchema.safeParse(params);
  if (!paging.success) return null;
  const { page, pageSize } = paging.data;
  if (page === undefined && pageSize === undefined) return null;
  if (search) return `/read/vocabulary?search=${encodeURIComponent(search)}`;
  const rank = (Math.max(1, page ?? 1) - 1) * (pageSize ?? DEFAULT_PAGE_SIZE) + 1;
  return `/read/vocabulary#${bandAnchorId(rankBandStart(rank))}`;
}

const SHELF_LOAD_TIMEOUT_MS = 30_000;
const SESSION_LOAD_TIMEOUT_MS = 1_500;

/** How many rows the shelf can ever hold: the committed reference list's size. */
const shelfCapacity = contentFrequencyWords().length;

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
 * this word. The tile shows the entry's *first* meaning; the full list travels
 * separately in the glossary map, in the reviewed file's own order.
 */
function toShelfItem(item: FrequencyWordItem, glossary: Record<string, VocabularyShelfGlossary>): VocabularyShelfItem {
  const entry = findCommonGlossaryEntry(item.word);
  const markKey = entry ? normalizeGlossarySurface(entry.headword) : normalizeGlossarySurface(item.word);
  if (entry && !glossary[markKey]) {
    glossary[markKey] = {
      cefr: entry.cefr,
      partOfSpeech: entry.partOfSpeech,
      meanings: entry.meanings.map((meaning) => ({ meaning: meaning.meaning, usage: meaning.usage })),
      collocations: entry.collocations,
      examples: entry.examples,
      forms: entry.forms ?? [],
    };
  }
  return {
    id: item.id,
    markKey,
    text: item.word,
    context: item.context,
    source: item.sourceTitle,
    meaning: entry?.meanings[0]?.meaning ?? null,
  };
}

export default async function VocabularyPage({ searchParams }: VocabularyPageProps) {
  const params = await searchParams;
  const parsed = shelfQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : shelfQuerySchema.parse({});
  const legacyTarget = legacyPagingTarget(params, query.search);
  if (legacyTarget) redirect(legacyTarget);

  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);

  let shelf: Awaited<ReturnType<typeof listFrequencyWords>> = { items: [], page: 1, pageSize: 0, total: 0 };
  let shelfUnavailable = !databaseUrlConfigured;

  // The shelf never needs the session, but the local mark scope does. Both start
  // together and the session is capped, so a slow account lookup can neither
  // delay the cold shelf nor fail the page.
  const [user, loaded] = await Promise.all([
    withTimeout(getCurrentUser(), SESSION_LOAD_TIMEOUT_MS).catch(() => null),
    (async () => {
      if (!databaseUrlConfigured) return null;
      try {
        const repository = createDrizzleLexiconCorpusRepository(getDatabase());
        // The shelf is one page now, so it is read whole. Its capacity is the
        // committed reference list's own length — no query is needed to learn
        // it, and one call means one corpus snapshot per request instead of two.
        // A search can only ever return fewer rows than that.
        return await withTimeout(
          listFrequencyWords(repository, { search: query.search, page: 1, pageSize: shelfCapacity }),
          SHELF_LOAD_TIMEOUT_MS,
        );
      } catch {
        // A configured database that cannot be read is an outage, not an empty
        // shelf: keep it distinguishable so the page says so instead of
        // claiming nothing matched.
        return { ok: false as const };
      }
    })(),
  ]);
  if (loaded) {
    if ("ok" in loaded) {
      shelfUnavailable = true;
    } else {
      shelf = loaded;
      shelfUnavailable = false;
    }
  }

  const glossary: Record<string, VocabularyShelfGlossary> = {};
  const items = shelf.items.map((item) => toShelfItem(item, glossary));
  // A search result's positions are not shelf ranks, so it gets no bands and no
  // rail rather than numbers it does not hold.
  const ranked = !query.search;
  const bands: readonly VocabularyRankBand[] = ranked && shelf.total ? groupRanks(items, 1, shelf.total).map((group) => group.band) : [];

  return <div className="page-stack read-page">
    <ReadSectionNavigation active="vocabulary" />
    <main className="lexicon-shelf">
      {/* Keep one page-level heading for assistive technology and the document
          outline; it stays visually hidden so the shelf starts directly with the
          search field and the word list. The section navigation already labels
          this page, and there is no second navigation to label a view. */}
      <h1 className="sr-only">词汇</h1>

      <VocabularyShelfControls query={{ search: query.search }} total={shelf.total} />

      {items.length ? <VocabularyShelf storageScope={user?.id ?? "anonymous"} glossary={glossary} bands={bands} total={shelf.total} ranked={ranked}>
        <VocabularyShelfList items={items} ranked={ranked} total={shelf.total} />
      </VocabularyShelf> : null}

      {shelfUnavailable && !items.length ? <div className="lexicon-empty lexicon-empty--error" role="alert"><h2>词汇表暂时不可用</h2><p>已发布内容仍然安全保留，请稍后刷新。</p></div> : null}
      {!shelfUnavailable && !items.length ? <div className="lexicon-empty"><h2>没有匹配的词</h2><p>换一个搜索词，或<Link href="/read/vocabulary">回到完整词表</Link>。</p></div> : null}
    </main>
  </div>;
}
