import type { PhraseQuery, VocabularyQuery, LexicalIntent, LexiconEntryKind } from "../schemas/lexicon";
import type { ContentReference } from "../domain";

export type VocabularyItem = Readonly<{
  id: string;
  lemma: string;
  normalizedLemma: string;
  partOfSpeech: string | null;
  lemmaStatus: "verified" | "pending";
  meaningZh: string | null;
  forms: readonly string[];
  occurrenceCount: number;
  intent: LexicalIntent | null;
  revision: number;
}>;

export type PhraseItem = Readonly<{
  id: string;
  expression: string;
  normalizedExpression: string;
  meaningZh: string | null;
  pragmaticPurpose: string | null;
  register: string | null;
  region: string | null;
  cefr: string | null;
  variants: readonly string[];
  occurrenceCount: number;
  intent: LexicalIntent | null;
  revision: number;
}>;

export type PagedResult<T> = Readonly<{ items: readonly T[]; page: number; pageSize: number; total: number }>;

export type LexemeIndexInput = Readonly<{
  lemma: string;
  normalizedLemma: string;
  lemmaStatus: "verified" | "pending";
  partOfSpeech: string | null;
  meaningZh?: string | null;
  form: string;
  normalizedForm: string;
  reference: ContentReference;
}>;

export type PhraseIndexInput = Readonly<{
  expression: string;
  normalizedExpression: string;
  meaningZh?: string | null;
  pragmaticPurpose?: string | null;
  register?: string | null;
  region?: string | null;
  cefr?: string | null;
  variant?: string | null;
  normalizedVariant?: string | null;
  ownerUserId?: string | null;
  reference: ContentReference;
}>;

export interface LexiconCorpusRepository {
  listVocabulary(userId: string | undefined, query: VocabularyQuery): Promise<PagedResult<VocabularyItem>>;
  listPhrases(userId: string | undefined, query: PhraseQuery): Promise<PagedResult<PhraseItem>>;
  setIntent(userId: string, entryKind: LexiconEntryKind, entryId: string, intent: LexicalIntent, expectedRevision?: number): Promise<Readonly<{ entryKind: LexiconEntryKind; entryId: string; intent: LexicalIntent; revision: number }>>;
  indexLexeme(input: LexemeIndexInput, sourceTitle: string, sourceKind: string): Promise<string>;
  indexPhrase(input: PhraseIndexInput, sourceTitle: string, sourceKind: string): Promise<string>;
}
