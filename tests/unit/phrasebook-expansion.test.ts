import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { phrasebookEntries, phrasebookVersion } from "@/src/modules/lexicon-corpus/content/phrasebook";
import { phrasebookEntries as originalEntries } from "@/src/modules/lexicon-corpus/content/phrasebook-v1";
import review from "@/src/modules/lexicon-corpus/content/phrasebook-v2.review.json";
import { normalizePhrasebookSearch, phrasebookEntrySchema, phraseTopics } from "@/src/modules/lexicon-corpus/domain/phrasebook";

describe("phrasebook content expansion", () => {
  it("preserves every original expression and bookmark ID without rewriting the reviewed first edition", () => {
    for (const original of originalEntries) expect(phrasebookEntries.find((entry) => entry.id === original.id)).toEqual(original);
    expect(phrasebookVersion).toBe("2026-10-15.v2");
    expect(phrasebookEntries).toHaveLength(60);
    expect(phrasebookEntries.filter((entry) => !originalEntries.some((original) => original.id === entry.id))).toHaveLength(36);
  });

  it("adds complete, distinct learning entries in every existing topic", () => {
    expect(new Set(phrasebookEntries.map((entry) => entry.id)).size).toBe(60);
    expect(new Set(phrasebookEntries.map((entry) => normalizePhrasebookSearch(entry.expression))).size).toBe(60);
    for (const topic of phraseTopics) expect(phrasebookEntries.filter((entry) => entry.topic === topic.id)).toHaveLength(10);
    for (const entry of phrasebookEntries) {
      expect(phrasebookEntrySchema.safeParse(entry).success, entry.id).toBe(true);
      expect(new Set(entry.alternatives.map((line) => normalizePhrasebookSearch(line.es))).size, entry.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("binds every content dependency to the new edition's independent dual review", () => {
    expect(review.contentVersion).toBe(phrasebookVersion);
    expect(review.entryCount).toBe(60);
    expect(review.addedEntryCount).toBe(36);
    expect(review.reviewerKind).toBe("ai");
    expect(review.sources.map((source) => source.file).sort()).toEqual([
      "phrasebook-expansion-a.ts", "phrasebook-expansion-b.ts", "phrasebook-v1.ts", "phrasebook-v2.ts", "phrasebook.ts",
    ]);
    for (const source of review.sources) {
      const content = readFileSync(`src/modules/lexicon-corpus/content/${source.file}`, "utf8").replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(content).digest("hex"), source.file).toBe(source.sha256);
    }
    expect(review.reviews.map((item) => [item.locale, item.status, item.newEntriesReviewed])).toEqual([["es-ES", "approved", 36], ["zh-CN", "approved", 36]]);
  });
});
