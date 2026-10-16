import type { PhraseQuery, VocabularyQuery, LexicalIntent, LexiconEntryKind } from "../schemas/lexicon";
import type { ContentReference } from "../domain";
import type { CorpusMatchMode, KwicResult, LexicalAssessmentPromptType } from "../domain";

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

export type FrequencyWordItem = Readonly<{
  id: string;
  word: string;
  normalizedWord: string;
  occurrenceCount: number;
  context: string | null;
  sourceTitle: string | null;
}>;

export type CorpusExample = Readonly<{
  word: string;
  sentence: string;
  translation: string | null;
  sourceTitle: string;
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  position: number;
}>;

export type PhraseItem = Readonly<{
  id: string;
  expression: string;
  normalizedExpression: string;
  scope: "public" | "private";
  meaningZh: string | null;
  pragmaticPurpose: string | null;
  register: string | null;
  region: string | null;
  cefr: string | null;
  variants: readonly string[];
  occurrenceCount: number;
  representativeOccurrence: PhraseOccurrence | null;
  intent: LexicalIntent | null;
  revision: number;
  /** True when this card is a read-only projection of published content, not a reviewed phrase entry. */
  isContentDiscovery?: boolean;
}>;

export type PhraseOccurrence = KwicResult & Readonly<{
  entryKind: "phrase";
  entryId: string;
  surfaceText: string;
}>;

export type PagedResult<T> = Readonly<{ items: readonly T[]; page: number; pageSize: number; total: number }>;

export type CorpusQuery = Readonly<{
  query?: string;
  match?: CorpusMatchMode;
  entryKind?: "lexeme" | "phrase";
  entryId?: string;
  documentKind?: "article" | "media";
  contentKind?: CorpusContentKind;
  sourceKind?: string;
  stableKey?: string;
  page: number;
  pageSize: number;
}>;

export type CorpusItem = KwicResult & Readonly<{
  entryKind: "lexeme" | "phrase";
  entryId: string;
  surfaceText: string;
  isContentDiscovery?: boolean;
}>;

export type CorpusContentKind = "article" | "video" | "podcast";

export type CorpusClusterContext = CorpusItem & Readonly<{
  contentKind: CorpusContentKind;
}>;

export type CorpusCluster = Readonly<{
  entryKind: "phrase";
  entryId: string;
  expression: string;
  meaningZh: string | null;
  pragmaticPurpose: string | null;
  contexts: readonly CorpusClusterContext[];
  contentKinds: readonly CorpusContentKind[];
  /** True when this cluster is derived directly from published content. */
  isContentDiscovery?: boolean;
}>;

export type CorpusBrowseQuery = Readonly<{
  query?: string;
  documentKind?: "article" | "media";
  contentKind?: CorpusContentKind;
  page: number;
  pageSize: number;
}>;

export type AssessmentItem = Readonly<{
  id: string;
  assessmentKey: string;
  version: number;
  entryKind: "lexeme" | "phrase";
  entryId: string | null;
  promptType: LexicalAssessmentPromptType;
  prompt: string;
  options: readonly string[];
  acceptedAnswers: readonly string[];
  sourceReference: Record<string, unknown>;
  skillKey: string;
  contentVersion: number;
}>;

export type AssessmentAttemptInput = Readonly<{ idempotencyKey: string; answer: string; requestHash: string }>;
export type AssessmentAttemptResult = Readonly<{ attemptId: string; assessmentKey: string; version: number; answer: string; passed: boolean; score: 0 | 1; normalizedAnswer: string; duplicate: boolean; evidence: "recorded" | "duplicate" }>;

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
  listFrequencyWords(query: Readonly<{ search?: string; page: number; pageSize: number }>): Promise<PagedResult<FrequencyWordItem>>;
  /**
   * The same row for a single word, without reading the whole shelf.
   *
   * The lookup cannot page: the reader typed a word and either it is on the shelf or
   * it is not. Loading all 7,892 rows and their snapshot to answer that would put a
   * multi-second read behind one form submit, so this asks the corpus about exactly
   * the word in hand and returns null when the reference list does not carry it.
   */
  readFrequencyWord(word: string): Promise<FrequencyWordItem | null>;
  findCorpusExample(word: string): Promise<CorpusExample | null>;
  listVocabulary(userId: string | undefined, query: VocabularyQuery): Promise<PagedResult<VocabularyItem>>;
  listPhrases(userId: string | undefined, query: PhraseQuery): Promise<PagedResult<PhraseItem>>;
  setIntent(userId: string, entryKind: LexiconEntryKind, entryId: string, intent: LexicalIntent, expectedRevision?: number): Promise<Readonly<{ entryKind: LexiconEntryKind; entryId: string; intent: LexicalIntent; revision: number }>>;
  indexLexeme(input: LexemeIndexInput, sourceTitle: string, sourceKind: string): Promise<string>;
  indexPhrase(input: PhraseIndexInput, sourceTitle: string, sourceKind: string): Promise<string>;
  searchCorpus(userId: string | undefined, query: CorpusQuery): Promise<PagedResult<CorpusItem>>;
  listCorpusClusters(userId: string | undefined, query: CorpusBrowseQuery): Promise<PagedResult<CorpusCluster>>;
  getAssessment(userId: string | undefined, assessmentKey: string): Promise<AssessmentItem | null>;
  submitAssessment(userId: string, assessmentKey: string, input: AssessmentAttemptInput): Promise<AssessmentAttemptResult>;
}
