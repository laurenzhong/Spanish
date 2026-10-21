import { getDatabase } from "@/src/shared/db/client";

import { contentFrequencyWords } from "../domain/frequency-word-list";
import { createDrizzleLexiconCorpusRepository } from "../repositories";

/**
 * The capacity of the shelf page: the reference list's own length.
 *
 * A bare `/read/vocabulary` visit asks for exactly this — the shelf is one page
 * now — so warming with the same value fills the same cache entry rather than a
 * different, smaller one.
 */
function shelfCapacity(): number {
  return contentFrequencyWords().length;
}

/**
 * Reads the vocabulary shelf once, in the background, when the server process
 * starts.
 *
 * The shelf's counts and examples come from one corpus snapshot that is cached
 * for ten minutes. When that cache is cold the *first* reader pays for the
 * snapshot read and the fold over ~63k forms, measured at **5.7 s through the
 * repository** even though the underlying statement itself runs in under a
 * millisecond; together with dev compilation that first request measured
 * **33.9 s**, past the page's own 30 s guard, which is what surfaced as
 * 「词汇表暂时不可用 / 已发布内容仍然安全保留，请稍后刷新。」 on a cold server.
 *
 * Warming moves that cost to boot, where nobody is waiting. It is deliberately
 * fire-and-forget: it must never delay or fail a server start, and a warm-up that
 * does not happen is simply the previous behaviour. No user data is read — the
 * warm call passes no user id and no search, so it touches only the public
 * reference list and the published corpus.
 */
export async function warmVocabularyShelf(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const repository = createDrizzleLexiconCorpusRepository(getDatabase());
  await repository.listFrequencyWords({ page: 1, pageSize: shelfCapacity() });
}
