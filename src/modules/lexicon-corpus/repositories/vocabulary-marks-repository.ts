import type { VocabularyMarks, VocabularyMarkStatus } from "../schemas/vocabulary-marks";

export interface VocabularyMarksRepository {
  read(userId: string): Promise<VocabularyMarks>;
  set(userId: string, word: string, status: VocabularyMarkStatus | null): Promise<VocabularyMarks>;
  /** Atomic import: existing rows, including clear tombstones, always win. */
  importMissing(userId: string, marks: Record<string, VocabularyMarkStatus>): Promise<VocabularyMarks>;
}
