import { normalizeSpanishSurface } from "./spanish-token";

export type LemmaStatus = "verified" | "pending";

export type Lexeme = Readonly<{
  lemma: string;
  normalizedLemma: string;
  language: "es";
  partOfSpeech: string | null;
  lemmaStatus: LemmaStatus;
}>;

export function normalizeLexeme(input: Readonly<{ surface: string; lemma?: string; partOfSpeech?: string | null }>): Lexeme {
  const candidate = input.lemma?.trim() || input.surface.trim();
  if (!candidate) throw new Error("LEXEME_SURFACE_REQUIRED");
  const lemmaStatus: LemmaStatus = input.lemma?.trim() ? "verified" : "pending";
  return {
    lemma: candidate,
    normalizedLemma: normalizeSpanishSurface(candidate),
    language: "es",
    partOfSpeech: input.partOfSpeech?.trim() || null,
    lemmaStatus,
  };
}
