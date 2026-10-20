import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

import "./vocabulary-shelf.css";

import {
  createDrizzleLexiconCorpusRepository,
  listFrequencyWords,
  VocabularyShelfControls,
} from "@/src/modules/lexicon-corpus";
// Deep import, like `@/src/modules/reading/domain/common-glossary` below: the
// domain module owns the reference list's size, which is the shelf's capacity.
import { contentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { VocabularyShelf, type VocabularyShelfGlossary } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf";
import { VocabularyShelfList } from "@/src/modules/lexicon-corpus/ui/vocabulary-shelf-list";
// The row builder is shared with the word lookup, so the two cannot disagree about
// what a word's tile and panel say.
import { shelfItem } from "@/src/modules/lexicon-corpus/ui/word-entry";
import { bandAnchorId, groupRanks, rankBandStart, type VocabularyRankBand } from "@/src/modules/lexicon-corpus/ui/vocabulary-rank";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";
import { loadLrMeaningAsset } from "@/src/modules/lexicon-corpus/application/lr-meaning-asset";
import { loadVocabularyShelf } from "@/src/modules/lexicon-corpus/application/load-vocabulary-shelf";

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

export default async function VocabularyPage({ searchParams }: VocabularyPageProps) {
  const params = await searchParams;
  const parsed = shelfQuerySchema.safeParse(params);
  const query = parsed.success ? parsed.data : shelfQuerySchema.parse({});
  const legacyTarget = legacyPagingTarget(params, query.search);
  if (legacyTarget) redirect(legacyTarget);

  const databaseUrlConfigured = Boolean(process.env.DATABASE_URL);

  // The shelf never needs the session, but the local mark scope does. Both start
  // together and the session is capped, so a slow account lookup can neither
  // delay the cold shelf nor fail the page.
  const [user, shelf] = await Promise.all([
    withTimeout(getCurrentUser(), SESSION_LOAD_TIMEOUT_MS).catch(() => null),
    loadVocabularyShelf({
      search: query.search,
      load: databaseUrlConfigured ? () => {
        const repository = createDrizzleLexiconCorpusRepository(getDatabase());
        // The shelf is one page now, so it is read whole. Its capacity is the
        // committed reference list's own length — no query is needed to learn
        // it, and one call means one corpus snapshot per request instead of two.
        // A search can only ever return fewer rows than that.
        return listFrequencyWords(repository, { search: query.search, page: 1, pageSize: shelfCapacity });
      } : undefined,
    }),
  ]);

  // The dictionaries are read once per process and never fetched inside the
  // request: an absent asset (the scrape has not landed) still renders the whole
  // shelf, just from the reviewed glossary alone.
  const meaningAsset = loadLrMeaningAsset();
  const glossary: Record<string, VocabularyShelfGlossary> = {};
  // Only the words on *this* page travel to the browser, keyed by the same mark
  // key the tiles carry, and only as bare translation lists: the rich per-word
  // shape measured 241 bytes a word against 40 for this one, and the page must
  // not get heavier than the scroll fix left it.
  const dictionary: Record<string, readonly string[]> = {};
  // The whole shelf renders into the document. An earlier attempt rendered only its first
  // bands and fetched the rest while scrolling, which made the page fast but the shelf feel
  // segmented; the owner rejected that, so the work moved to making one full document
  // cheaper instead: the tiles are one HTML string rather than 7,922 serialised elements, and
  // Tatoeba's examples are fetched per opened word (`?fields=tatoeba`) instead of travelling
  // for all of them — together 9.42 MB and 17.0 s to first interaction, down to 7.86 MB and
  // 0.62 s to first paint.
  const items = shelf.items.map((item) => {
    const row = shelfItem(item, glossary, meaningAsset.meanings);
    const translated = meaningAsset.meanings[item.word];
    if (translated?.length && !dictionary[row.markKey]) dictionary[row.markKey] = translated;
    return row;
  });
  // A search result's positions are not shelf ranks, so it gets no bands and no
  // rail rather than numbers it does not hold.
  const ranked = !query.search;
  const bands: readonly VocabularyRankBand[] = ranked && shelf.total ? groupRanks(items, 1, shelf.total).map((group) => group.band) : [];

  return <main className="lexicon-shelf">
    {/* Keep one page-level heading for assistive technology and the document
        outline; it stays visually hidden so the shelf starts directly with the
        search field and the word list. The section layout above already labels
        this page with its navigation, and there is no second navigation to label
        a view. */}
    <h1 className="sr-only">词汇</h1>

    {items.length ? <VocabularyShelf key={`${user?.id ?? "anonymous"}:${query.search ?? ""}`} controls={<VocabularyShelfControls query={{ search: query.search }} total={shelf.total} />} storageScope={user?.id ?? "anonymous"} glossary={glossary} dictionary={dictionary} bands={bands} total={shelf.total} ranked={ranked}>
      <VocabularyShelfList items={items} ranked={ranked} total={shelf.total} />
    </VocabularyShelf> : <VocabularyShelfControls query={{ search: query.search }} total={shelf.total} />}

    {shelf.examplesUnavailable && items.length ? <p className="vocabulary-recall__help" role="status">部分例句暂时不可用，词表和默写可以继续使用。</p> : null}
    {!items.length ? <div className="lexicon-empty"><h2>没有匹配的词</h2><p>换一个搜索词，或<Link href="/read/vocabulary">回到完整词表</Link>。</p></div> : null}
  </main>;
}
