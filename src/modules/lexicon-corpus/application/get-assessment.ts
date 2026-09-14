import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { lexicalAssessmentKeySchema } from "../schemas/lexicon";

export async function getAssessment(repository: LexiconCorpusRepository, userId: string | undefined, assessmentKey: string) {
  return repository.getAssessment(userId, lexicalAssessmentKeySchema.parse(assessmentKey));
}
