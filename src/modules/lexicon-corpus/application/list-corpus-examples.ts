import type { CorpusExamplesRepository } from "../repositories/corpus-examples-repository";
import { corpusExamplesQuerySchema } from "../schemas/corpus-examples";

export function listCorpusExamples(repository: CorpusExamplesRepository, userId: string, input: unknown) {
  return repository.list(userId, corpusExamplesQuerySchema.parse(input));
}
