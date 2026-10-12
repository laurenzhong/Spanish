export type SpanishToken = Readonly<{
  surface: string;
  normalized: string;
  start: number;
  end: number;
}>;

const tokenPattern = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

export function normalizeSpanishSurface(surface: string): string {
  return surface
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es");
}

/**
 * Case-folded surface with its accents **kept**, for identity rather than lookup.
 *
 * `normalizeSpanishSurface` is the lookup key: it folds `ñ` to `n` so a form
 * matches however it was typed, which is right for finding a word in a corpus and
 * wrong for deciding whether two words *are* the same word. `el`/`él`, `si`/`sí`,
 * `mas`/`más` and `una`/`uña` are different words, and the reference list keeps
 * them apart — `solo` and `sólo` are separate rows, which is how a duplicate React
 * key exposed this during the shelf work.
 *
 * Used for the candidate identity, so two different words cannot share an id.
 * The stored `normalizedText` keeps the folded form, because the corpus writer
 * uses it as the matching key.
 */
export function caseFoldSurface(surface: string): string {
  return surface.trim().toLocaleLowerCase("es");
}

export function tokenizeSpanish(text: string): readonly SpanishToken[] {
  const tokens: SpanishToken[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    const surface = match[0];
    const start = match.index ?? 0;
    tokens.push({ surface, normalized: normalizeSpanishSurface(surface), start, end: start + surface.length });
  }
  return tokens;
}
