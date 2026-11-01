import type { RecallMode } from "./vocabulary-recall";

export type RecallQueue = "learning" | "review" | "all";
type Progress = Readonly<{ word: string; mode: RecallMode; stage: "learning" | "review"; nextReviewAt: string | null }>;

function indexProgress(progress: readonly Progress[], mode: RecallMode) {
  return new Map(progress.filter((item) => item.mode === mode).map((item) => [item.word, item]));
}

export function summarizeRecallQueue(keys: readonly string[], progress: readonly Progress[], mode: RecallMode, now: number) {
  const byWord = indexProgress(progress, mode);
  const counts = { learning: 0, review: 0, due: 0 };
  for (const key of new Set(keys)) {
    const item = byWord.get(key);
    if (!item || item.stage === "learning") counts.learning += 1;
    else {
      counts.review += 1;
      if (item.nextReviewAt !== null && Date.parse(item.nextReviewAt) <= now) counts.due += 1;
    }
  }
  return counts;
}

/** Caller provides eligible marked words in shelf order; never invents unseen words. */
export function selectRecallKeys(keys: readonly string[], progress: readonly Progress[], mode: RecallMode, queue: RecallQueue, limit: number, now: number): string[] {
  const byWord = indexProgress(progress, mode);
  return [...new Set(keys)].filter((key) => {
    const item = byWord.get(key);
    if (queue === "all") return true;
    if (queue === "learning") return !item || item.stage === "learning";
    return item?.stage === "review" && item.nextReviewAt !== null && Date.parse(item.nextReviewAt) <= now;
  }).slice(0, Math.max(0, Math.min(20, Math.floor(limit))));
}
