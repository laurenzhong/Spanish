import glossarySource from "@/content/glossary/es-zh-common-v1.json";

export type CommonGlossaryMeaning = Readonly<{
  meaning: string;
  usage: string;
}>;

export type CommonGlossaryEntry = Readonly<{
  headword: string;
  partOfSpeech: string;
  meanings: readonly CommonGlossaryMeaning[];
  collocations: readonly string[];
  examples: readonly string[];
  forms?: readonly string[];
  cefr: string;
  reviewStatus: "reviewed";
}>;

const entries = glossarySource.entries as readonly CommonGlossaryEntry[];

/**
 * Glossary lookups ignore case and accents so that a reader selection such as
 * "café" or "¿Cómo?" resolves to the reviewed entry "café". Inflected forms
 * declared by an entry resolve to the same headword.
 */
export function normalizeGlossarySurface(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es")
    .replace(/^[^a-z]+|[^a-z]+$/gu, "");
}

function indexGlossary(): Map<string, CommonGlossaryEntry> {
  const index = new Map<string, CommonGlossaryEntry>();
  for (const entry of entries) {
    const headword = normalizeGlossarySurface(entry.headword);
    if (headword && !index.has(headword)) index.set(headword, entry);
  }
  for (const entry of entries) {
    for (const form of entry.forms ?? []) {
      const normalized = normalizeGlossarySurface(form);
      if (normalized && !index.has(normalized)) index.set(normalized, entry);
    }
  }
  return index;
}

const lookupIndex = indexGlossary();

export function listCommonGlossaryEntries(): readonly CommonGlossaryEntry[] {
  return entries;
}

export function findCommonGlossaryEntry(value: string): CommonGlossaryEntry | null {
  const normalized = normalizeGlossarySurface(value);
  return normalized ? lookupIndex.get(normalized) ?? null : null;
}

/** @deprecated Use findCommonGlossaryEntry; kept for the existing reader call site. */
export function getCommonGlossaryEntry(value: string): CommonGlossaryEntry | null {
  return findCommonGlossaryEntry(value);
}

export function glossaryEntrySummary(entry: CommonGlossaryEntry): string {
  return entry.meanings.map((item) => item.meaning).join("；");
}
