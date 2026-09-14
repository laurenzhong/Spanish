import { normalizeSpanishSurface, tokenizeSpanish } from "./spanish-token";

export type PhraseMatch = Readonly<{
  startToken: number;
  endToken: number;
  surface: string;
  normalized: string;
}>;

export function normalizePhrase(text: string): string {
  return tokenizeSpanish(text).map((token) => token.normalized).join(" ");
}

export function findPhraseMatches(text: string, phrase: string): readonly PhraseMatch[] {
  const tokens = tokenizeSpanish(text);
  const pattern = tokenizeSpanish(phrase).map((token) => token.normalized);
  if (pattern.length === 0) return [];
  const matches: PhraseMatch[] = [];
  for (let start = 0; start <= tokens.length - pattern.length; start += 1) {
    if (!pattern.every((token, offset) => tokens[start + offset]?.normalized === token)) continue;
    const endToken = start + pattern.length - 1;
    matches.push({
      startToken: start,
      endToken,
      surface: text.slice(tokens[start].start, tokens[endToken].end),
      normalized: pattern.join(" "),
    });
  }
  return matches;
}

export function normalizePhraseToken(surface: string): string {
  return normalizeSpanishSurface(surface);
}
