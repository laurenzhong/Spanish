import type { ContentReference } from "./content-reference";

export type CorpusOccurrence = Readonly<{
  entryId: string;
  entryKind: "lexeme" | "phrase";
  reference: ContentReference;
  surfaceText: string;
  normalizedText: string;
}>;

export function buildContext(texts: readonly string[], index: number): Readonly<{ before: string; current: string; after: string }> {
  return {
    before: texts[index - 1] ?? "",
    current: texts[index] ?? "",
    after: texts[index + 1] ?? "",
  };
}
