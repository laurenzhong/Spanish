import type { LexiconCorpusRepository } from "../repositories/lexicon-corpus-repository";
import { setLexicalIntentSchema } from "../schemas/lexicon";

export async function setLexicalIntent(repository: LexiconCorpusRepository, userId: string, entryId: string, input: unknown) {
  const parsed = setLexicalIntentSchema.parse(input);
  return repository.setIntent(userId, parsed.entryKind, entryId, parsed.intent, parsed.expectedRevision);
}
