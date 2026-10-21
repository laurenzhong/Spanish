import {
  createDrizzleLexiconCorpusRepository,
  LexiconPagination,
  listPhrases,
  PhraseLibrary,
  phraseQuerySchema,
  PhraseShelfControls,
} from "@/src/modules/lexicon-corpus";
import type { PagedResult, PhraseItem } from "@/src/modules/lexicon-corpus/repositories/lexicon-corpus-repository";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

/**
 * The phrases shelf read, behind the page's Suspense boundary.
 *
 * The guard is deliberately generous. This is the page's own content, not
 * decoration, and it is measured against a remote pooler: a cold connection
 * costs ~2.0 s before the first statement even runs (`select 1` measured
 * 2035 ms cold / 224 ms warm) and the shelf read itself measured
 * 3907 ms cold / 1685 ms / 507 ms warm. The previous 2500 ms budget sat below
 * that floor, so a cold load always tripped it and the page reported
 * 「短语库暂时不可用」 instead of showing its data or an honest empty shelf.
 */
const LEXICON_LOAD_TIMEOUT_MS = 8_000;

/** A successful zero-result read has already taken the discovery fallback path. */
export function isPhraseDiscoveryPage(result: Pick<PagedResult<PhraseItem>, "items" | "total">, unavailable: boolean): boolean {
  return !unavailable && (result.items.some((item) => item.isContentDiscovery) || result.total === 0);
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("LEXICON_LOAD_TIMEOUT")), milliseconds); }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
}

export async function PhraseShelfData({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const parsed = phraseQuerySchema.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : phraseQuerySchema.parse({});
  let result: Awaited<ReturnType<typeof listPhrases>> = { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
  let unavailable = !process.env.DATABASE_URL;
  if (process.env.DATABASE_URL) {
    try {
      result = await withTimeout((async () => {
        const user = await getCurrentUser();
        return listPhrases(createDrizzleLexiconCorpusRepository(getDatabase()), user?.id, query);
      })(), LEXICON_LOAD_TIMEOUT_MS);
    } catch { unavailable = true; }
  }
  const filtered = Boolean(query.search || query.intent || query.pragmaticPurpose || query.register || query.region || query.cefr);
  const discovery = isPhraseDiscoveryPage(result, unavailable);
  const resultKey = [query.search, query.intent, query.pragmaticPurpose, query.register, query.region, query.cefr, query.page, query.pageSize].join(":");
  return <>
    <PhraseShelfControls query={query} total={result.total} discovery={discovery} />
    <PhraseLibrary key={resultKey} filtered={filtered} items={result.items} total={result.total} unavailable={unavailable} discovery={discovery} />
    <LexiconPagination basePath="/read/phrases" page={result.page} pageSize={result.pageSize} total={result.total} query={{ search: query.search, intent: query.intent, pragmaticPurpose: query.pragmaticPurpose, register: query.register, region: query.region, cefr: query.cefr, pageSize: query.pageSize }} />
  </>;
}
