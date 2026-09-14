import type { ContentReference } from "../domain";
import type { LexemeIndexInput, LexiconCorpusRepository, PhraseIndexInput } from "../repositories/lexicon-corpus-repository";

export type ContentIndexSegment = Readonly<{
  text: string;
  reference: ContentReference;
}>;

export async function indexContentVersion(
  repository: LexiconCorpusRepository,
  input: Readonly<{ sourceTitle: string; sourceKind: string; lexemes?: readonly Omit<LexemeIndexInput, "reference">[]; phrases?: readonly Omit<PhraseIndexInput, "reference">[]; segments: readonly ContentIndexSegment[] }>,
): Promise<Readonly<{ lexemes: number; phrases: number }>> {
  let lexemes = 0;
  let phrases = 0;
  for (const segment of input.segments) {
    for (const entry of input.lexemes ?? []) {
      await repository.indexLexeme({ ...entry, reference: segment.reference }, input.sourceTitle, input.sourceKind);
      lexemes += 1;
    }
    for (const entry of input.phrases ?? []) {
      await repository.indexPhrase({ ...entry, reference: segment.reference }, input.sourceTitle, input.sourceKind);
      phrases += 1;
    }
  }
  return { lexemes, phrases };
}
