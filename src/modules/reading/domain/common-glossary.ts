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
  cefr: string;
  reviewStatus: "reviewed";
}>;

const entries = glossarySource.entries as readonly CommonGlossaryEntry[];

export function getCommonGlossaryEntry(value: string): CommonGlossaryEntry | null {
  const normalized = value.toLocaleLowerCase();
  return entries.find((entry) => entry.headword.toLocaleLowerCase() === normalized) ?? null;
}
