import { normalizeSpanishSurface, tokenizeSpanish } from "./spanish-token";

/** Offsets always refer to the original text; accents and punctuation stay intact. */
export function corpusHighlightRanges(text: string, query: string, mode: "phrase" | "all") {
  const terms = tokenizeSpanish(query).map((token) => token.normalized);
  const tokens = tokenizeSpanish(text);
  if (!terms.length) return [];
  if (mode === "all") return tokens.filter((token) => terms.includes(normalizeSpanishSurface(token.surface))).map(({ start, end }) => ({ start, end }));
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (!terms.every((term, offset) => tokens[index + offset]?.normalized === term)) continue;
    ranges.push({ start: tokens[index].start, end: tokens[index + terms.length - 1].end });
    index += terms.length - 1;
  }
  return ranges;
}
