import { listCommonGlossaryEntries, normalizeGlossarySurface } from "./common-glossary";

export type StudyVocabularyMeaning = Readonly<{ meaning: string; usage: string }>;

export type StudyVocabularyWord = Readonly<{
  id: string;
  headword: string;
  partOfSpeech: string;
  cefr: string;
  meanings: readonly StudyVocabularyMeaning[];
  collocations: readonly string[];
  examples: readonly string[];
  forms: readonly string[];
  occurrenceCount: number | null;
}>;

/**
 * The study shelf is built from the reviewed Spanish–Chinese glossary, so every
 * row is directly learnable: headword, part of speech, meaning, usage,
 * collocations and examples. Corpus frequencies are attached separately.
 */
export function listStudyVocabularyWords(): readonly StudyVocabularyWord[] {
  return listCommonGlossaryEntries().map((entry) => ({
    id: normalizeGlossarySurface(entry.headword),
    headword: entry.headword,
    partOfSpeech: entry.partOfSpeech,
    cefr: entry.cefr,
    meanings: entry.meanings,
    collocations: entry.collocations,
    examples: entry.examples,
    forms: entry.forms ?? [],
    occurrenceCount: null,
  }));
}
