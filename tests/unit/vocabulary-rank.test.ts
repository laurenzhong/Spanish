import { describe, expect, it } from "vitest";

import {
  activeRankMilestone,
  pageForRank,
  rankBandFor,
  rankMilestoneLabel,
  reachableRankMilestones,
  vocabularyRankBandSize,
  vocabularyRankMilestones,
} from "@/src/modules/lexicon-corpus/ui/vocabulary-rank";

// The shelf's real size, used by every boundary below.
const shelfTotal = 7_922;

describe("vocabulary rank navigation", () => {
  it("keeps the reference rail's milestone enum and spelling", () => {
    expect(vocabularyRankMilestones).toEqual([1, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000]);
    expect(vocabularyRankMilestones.map(rankMilestoneLabel)).toEqual(["1", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1k", "2k", "3k", "4k", "5k", "6k", "7k"]);
  });

  it("never offers a milestone the shelf cannot reach", () => {
    expect(reachableRankMilestones(shelfTotal)).toHaveLength(17);
    expect(reachableRankMilestones(100)).toEqual([1, 100]);
    expect(reachableRankMilestones(99)).toEqual([1]);
    expect(reachableRankMilestones(1)).toEqual([1]);
    expect(reachableRankMilestones(999)).toEqual([1, 100, 200, 300, 400, 500, 600, 700, 800, 900]);
    // A shelf that shrank below a milestone drops it instead of linking nowhere.
    expect(reachableRankMilestones(4_500)).not.toContain(5_000);
  });

  it("maps a rank to the page that holds it, on both page edges", () => {
    expect(pageForRank(1, 24)).toBe(1);
    expect(pageForRank(24, 24)).toBe(1);
    expect(pageForRank(25, 24)).toBe(2);
    expect(pageForRank(1_000, 24)).toBe(42);
    expect(pageForRank(7_000, 24)).toBe(292);
    expect(pageForRank(shelfTotal, 24)).toBe(331);
    // 50 per page: rank 7000 is the last word of page 140 (6951-7000).
    expect(pageForRank(7_000, 50)).toBe(140);
    // Degenerate inputs stay on page 1 rather than producing page 0 or NaN.
    expect(pageForRank(0, 24)).toBe(1);
    expect(pageForRank(1, 0)).toBe(1);
  });

  it("groups ranks into the reference bands and clips the last one to the shelf", () => {
    expect(vocabularyRankBandSize).toBe(100);
    expect(rankBandFor(1, shelfTotal)).toEqual({ start: 1, end: 100 });
    expect(rankBandFor(100, shelfTotal)).toEqual({ start: 1, end: 100 });
    expect(rankBandFor(101, shelfTotal)).toEqual({ start: 101, end: 200 });
    expect(rankBandFor(7_901, shelfTotal)).toEqual({ start: 7_901, end: 7_922 });
    expect(rankBandFor(shelfTotal, shelfTotal)).toEqual({ start: 7_901, end: 7_922 });
    // A short shelf's first band says how short it really is.
    expect(rankBandFor(3, 3)).toEqual({ start: 1, end: 3 });
  });

  it("marks the last milestone the reader has passed", () => {
    expect(activeRankMilestone(1, shelfTotal)).toBe(1);
    expect(activeRankMilestone(99, shelfTotal)).toBe(1);
    expect(activeRankMilestone(100, shelfTotal)).toBe(100);
    expect(activeRankMilestone(985, shelfTotal)).toBe(900);
    expect(activeRankMilestone(1_000, shelfTotal)).toBe(1_000);
    expect(activeRankMilestone(1_001, shelfTotal)).toBe(1_000);
    expect(activeRankMilestone(7_001, shelfTotal)).toBe(7_000);
    expect(activeRankMilestone(shelfTotal, shelfTotal)).toBe(7_000);
    // Past the shelf's end the marker still resolves to a real entry.
    expect(activeRankMilestone(9_000, shelfTotal)).toBe(7_000);
  });
});
