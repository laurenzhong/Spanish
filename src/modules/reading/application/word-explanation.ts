import type {
  WordExplanation,
  WordExplanationInput,
  WordExplanationProvider,
} from "@/src/modules/providers/word-explanation";

export async function explainWord(
  provider: WordExplanationProvider,
  input: WordExplanationInput,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<WordExplanation> {
  return provider.explain(input, options);
}
