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

export function tokenizeSpanish(text: string): readonly SpanishToken[] {
  const tokens: SpanishToken[] = [];
  for (const match of text.matchAll(tokenPattern)) {
    const surface = match[0];
    const start = match.index ?? 0;
    tokens.push({ surface, normalized: normalizeSpanishSurface(surface), start, end: start + surface.length });
  }
  return tokens;
}
