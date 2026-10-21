/**
 * Rank navigation math for the vocabulary shelf, kept pure so the boundaries
 * (first rank, last band, milestones past the shelf's end) are testable without
 * rendering.
 *
 * A *rank* here is a 1-based position in the shelf the reader is looking at:
 * rank 1 is the most frequent **content** word, because the reference list's
 * function words are filtered out before the shelf is built. That is why the
 * rail's numbers are shelf positions, not the raw reference file's row numbers
 * (the reference list numbers function words too, so `ser` is its row 4 while it
 * is the shelf's rank 1). The UI states this; nothing here may imply a position
 * the shelf cannot reach.
 */

/** The band width the shelf groups words by, as the reference design does. */
export const vocabularyRankBandSize = 100;

/**
 * The reference rail's milestones: the first hundred, then every hundred up to
 * 900, then thousands up to 7k. It stops at 7k because that is the last
 * milestone the 7,922-word shelf reaches; anything past `total` is dropped by
 * `reachableRankMilestones`, never rendered as a dead destination.
 */
export const vocabularyRankMilestones = [1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000] as const;

/** `1k`-style label, spelled the way the reference rail spells it. */
export function rankMilestoneLabel(rank: number): string {
  return rank >= 1_000 && rank % 1_000 === 0 ? `${rank / 1_000}k` : String(rank);
}

/** Only the milestones the shelf actually contains, so the rail never lies. */
export function reachableRankMilestones(total: number): readonly number[] {
  return vocabularyRankMilestones.filter((rank) => rank <= total);
}

/** The DOM id of the band that starts at `start`; the rail's jump destination. */
export function bandAnchorId(start: number): string {
  return `vocabulary-band-${start}`;
}

/** The first rank of the band holding `rank` (its anchor target as well). */
export function rankBandStart(rank: number): number {
  const safeRank = Math.max(1, Math.trunc(rank));
  return Math.floor((safeRank - 1) / vocabularyRankBandSize) * vocabularyRankBandSize + 1;
}

export type VocabularyRankBand = Readonly<{ start: number; end: number }>;

/**
 * The band a rank belongs to (`排名 1 - 100` …). The last band ends at the
 * shelf's real end, so the shelf's final heading says `排名 7901 - 7922`
 * instead of claiming a hundred words that do not exist.
 */
export function rankBandFor(rank: number, total: number): VocabularyRankBand {
  const start = rankBandStart(rank);
  return { start, end: Math.min(start + vocabularyRankBandSize - 1, Math.max(start, Math.trunc(total))) };
}

/**
 * Where a milestone takes the reader. The shelf is one page now, so a milestone
 * is a fragment: it scrolls to the band holding that rank rather than opening a
 * page that no longer exists.
 */
export function rankBandAnchor(rank: number, total: number): string {
  return bandAnchorId(rankBandFor(rank, total).start);
}

/**
 * The milestone the reader has reached: the largest one at or before `rank`.
 * With the shelf on one page this doubles as the rail's "you are here" marker
 * for the band currently in view.
 */
export function activeRankMilestone(rank: number, total: number): number {
  const reached = reachableRankMilestones(total).filter((milestone) => milestone <= rank);
  return reached.length ? reached[reached.length - 1]! : 1;
}

/**
 * Split an ordered list into its rank bands. Generic so the shelf's own row
 * type stays in the UI layer; the arithmetic is the tested part.
 */
export function groupRanks<T>(items: readonly T[], firstRank: number, total: number): readonly Readonly<{ band: VocabularyRankBand; items: readonly T[] }>[] {
  const grouped: { band: VocabularyRankBand; items: T[] }[] = [];
  for (const [index, item] of items.entries()) {
    const band = rankBandFor(firstRank + index, total);
    const previous = grouped[grouped.length - 1];
    if (previous?.band.start === band.start) previous.items.push(item);
    else grouped.push({ band, items: [item] });
  }
  return grouped;
}
