import type { VocabularyRecallProgressResponse, VocabularyRecallProgressWrite } from "../schemas/vocabulary-recall-progress";

export interface VocabularyRecallProgressRepository {
  read(userId: string): Promise<VocabularyRecallProgressResponse>;
  save(userId: string, input: VocabularyRecallProgressWrite, now: Date): Promise<VocabularyRecallProgressResponse>;
}
