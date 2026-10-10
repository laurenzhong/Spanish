import { describe, expect, it } from "vitest";

import {
  findCommonGlossaryEntry,
  listCommonGlossaryEntries,
  normalizeGlossarySurface,
} from "@/src/modules/reading/domain/common-glossary";
import { listStudyVocabularyWords } from "@/src/modules/reading/domain/study-vocabulary";

describe("reviewed common glossary", () => {
  const entries = listCommonGlossaryEntries();

  it("keeps every study entry learnable and unique", () => {
    expect(entries.length).toBeGreaterThan(70);
    expect(new Set(entries.map((entry) => entry.headword)).size).toBe(entries.length);
    for (const entry of entries) {
      expect(entry.reviewStatus).toBe("reviewed");
      expect(entry.cefr).toMatch(/^[ABC][12]$/u);
      expect(entry.partOfSpeech.trim().length).toBeGreaterThan(0);
      expect(entry.meanings.length).toBeGreaterThan(0);
      for (const meaning of entry.meanings) {
        expect(meaning.meaning.trim().length).toBeGreaterThan(0);
        expect(meaning.usage.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("stores corpus-matchable forms without accents or capitals", () => {
    for (const entry of entries) {
      for (const form of entry.forms ?? []) {
        expect(form).toBe(normalizeGlossarySurface(form));
      }
    }
    const indexed = entries.flatMap((entry) => [normalizeGlossarySurface(entry.headword), ...(entry.forms ?? [])]);
    expect(new Set(indexed).size).toBe(indexed.length);
  });

  it("resolves accented, punctuated and inflected reader selections", () => {
    expect(findCommonGlossaryEntry("café")?.headword).toBe("café");
    expect(findCommonGlossaryEntry("«casa»")?.headword).toBe("casa");
    expect(findCommonGlossaryEntry("CAFÉS")?.headword).toBe("café");
    expect(findCommonGlossaryEntry("quiero")?.headword).toBe("querer");
    expect(findCommonGlossaryEntry("están")?.headword).toBe("estar");
    expect(findCommonGlossaryEntry("casas")?.headword).toBe("casa");
    expect(findCommonGlossaryEntry("zzz")).toBeNull();
  });

  it("builds the study shelf from reviewed entries only", () => {
    const words = listStudyVocabularyWords();
    expect(words.length).toBe(entries.length);
    const casa = words.find((word) => word.headword === "casa");
    expect(casa).toMatchObject({ id: "casa", cefr: "A1", partOfSpeech: "名词" });
    expect(casa?.meanings[0]?.meaning).toContain("房子");
    expect(words.every((word) => word.meanings.length > 0)).toBe(true);
    expect(new Set(words.map((word) => word.id)).size).toBe(words.length);
  });
});
