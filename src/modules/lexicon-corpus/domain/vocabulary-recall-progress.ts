/** Personal self-check scheduling only; never an assessment, mastery or evidence. */
export type VocabularyRecallProgress = Readonly<{
  word: string;
  mode: "word" | "meaning";
  stage: "learning" | "review";
  revision: number;
  successfulReviews: number;
  nextReviewAt: string | null;
}>;
export type VocabularyRecallProgressEntry = Readonly<{
  word: string;
  mode: "word" | "meaning";
  result: "correct" | "accent" | "incorrect" | "pending";
  hinted: boolean;
  selfConfirmed: boolean;
  expectedRevision: number;
}>;

const intervalsDays = [1, 3, 7, 14, 30] as const;
export function advanceVocabularyRecallProgress(
  current: VocabularyRecallProgress | null,
  entry: VocabularyRecallProgressEntry,
  now: Date,
): VocabularyRecallProgress {
  const base = { word: entry.word, mode: entry.mode, revision: (current?.revision ?? 0) + 1 };
  if (entry.result !== "correct" || entry.hinted || entry.selfConfirmed) {
    return { ...base, stage: "learning", successfulReviews: 0, nextReviewAt: null };
  }
  // Voluntary practice before due must not inflate the spacing schedule.
  if (current?.stage === "review" && current.nextReviewAt && Date.parse(current.nextReviewAt) > now.getTime()) {
    return { ...current, ...base };
  }
  const successfulReviews = Math.min((current?.successfulReviews ?? 0) + 1, intervalsDays.length);
  const days = intervalsDays[successfulReviews - 1]!;
  return { ...base, stage: "review", successfulReviews, nextReviewAt: new Date(now.getTime() + days * 86_400_000).toISOString() };
}

export class VocabularyRecallProgressConflict extends Error {
  constructor() { super("VOCABULARY_RECALL_PROGRESS_CONFLICT"); }
}
