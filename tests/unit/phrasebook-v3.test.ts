import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { phrasebookEntries, phrasebookVersion } from "@/src/modules/lexicon-corpus/content/phrasebook-v3";
import { phrasebookEntries as previousEntries } from "@/src/modules/lexicon-corpus/content/phrasebook-v2";
import review from "@/src/modules/lexicon-corpus/content/phrasebook-v3.review.json";
import { matchesPhrasebookSearch, normalizePhrasebookSearch, phrasebookEntrySchema, phraseTopics } from "@/src/modules/lexicon-corpus/domain/phrasebook";

describe("third-edition phrasebook", () => {
  it("preserves all sixty reviewed entries and bookmark IDs", () => {
    expect(phrasebookVersion).toBe("2026-10-15.v3");
    expect(phrasebookEntries).toHaveLength(120);
    for (const entry of previousEntries) expect(phrasebookEntries.find((item) => item.id === entry.id)).toEqual(entry);
    expect(phrasebookEntries.filter((entry) => !previousEntries.some((old) => old.id === entry.id))).toHaveLength(60);
  });

  it("covers six purposes with complete distinct teaching entries", () => {
    expect(new Set(phrasebookEntries.map((entry) => entry.id)).size).toBe(120);
    expect(new Set(phrasebookEntries.map((entry) => normalizePhrasebookSearch(entry.expression))).size).toBe(120);
    for (const topic of phraseTopics) expect(phrasebookEntries.filter((entry) => entry.topic === topic.id)).toHaveLength(20);
    for (const entry of phrasebookEntries) {
      expect(phrasebookEntrySchema.safeParse(entry).success, entry.id).toBe(true);
      expect(new Set(entry.alternatives.map((line) => normalizePhrasebookSearch(line.es))).size, entry.id).toBeGreaterThanOrEqual(2);
      expect(matchesPhrasebookSearch(entry, entry.expression), entry.id).toBe(true);
    }
  });

  it("binds every dependency to the independently reviewed third edition", () => {
    expect(review.contentVersion).toBe(phrasebookVersion);
    expect(review.entryCount).toBe(120);
    expect(review.addedEntryCount).toBe(60);
    expect(review.reviewerKind).toBe("ai");
    expect(review.previousReview).toBe("phrasebook-v2.review.json");
    expect(review.sources.map((source) => source.file).sort()).toEqual([
      "phrasebook-expansion-a.ts", "phrasebook-expansion-b.ts", "phrasebook-v1.ts", "phrasebook-v2.ts", "phrasebook-v3-practical.ts", "phrasebook-v3-social.ts", "phrasebook-v3.ts",
    ]);
    for (const source of review.sources) {
      const content = readFileSync(`src/modules/lexicon-corpus/content/${source.file}`, "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(content).digest("hex"), source.file).toBe(source.sha256);
    }
    expect(review.reviews.map((item) => [item.locale, item.status, item.newEntriesReviewed])).toEqual([["es-ES", "approved", 60], ["zh-CN", "approved", 60]]);
  });
});
