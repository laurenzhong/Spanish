import { tokenizeSpanish, type SpanishToken } from "./spanish-token";

export type ContentDiscoverySegment = Readonly<{
  documentKind: "article" | "media";
  contentKind: "article" | "video" | "podcast";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  startMs?: number;
  endMs?: number;
  sourceText: string;
  sourceTitle: string;
  sourceKind: string;
  publishedAt: Date | null;
}>;

export type ContentDiscoveryExpression = Readonly<{
  expression: string;
  normalizedExpression: string;
  segment: ContentDiscoverySegment;
  start: number;
  end: number;
}>;

const stopWords = new Set([
  "a", "al", "algo", "ante", "con", "como", "de", "del", "el", "en", "entre", "es", "esta", "este", "la", "las", "le", "lo", "los", "me", "mi", "muy", "no", "nos", "o", "para", "por", "que", "se", "su", "sus", "te", "tu", "un", "una", "unos", "y", "ya",
]);

function windowScore(tokens: readonly SpanishToken[], start: number, length: number): number {
  const window = tokens.slice(start, start + length);
  const contentCount = window.filter((token) => !stopWords.has(token.normalized)).length;
  if (contentCount === 0) return -1;
  const edgePenalty = (stopWords.has(window[0]?.normalized ?? "") ? 1 : 0) + (stopWords.has(window.at(-1)?.normalized ?? "") ? 1 : 0);
  return contentCount * 10 + length - edgePenalty * 2;
}

export function extractContentExpression(segment: ContentDiscoverySegment): ContentDiscoveryExpression | null {
  const tokens = tokenizeSpanish(segment.sourceText);
  let best: { score: number; start: number; length: number } | null = null;
  for (const length of [3, 2]) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      const score = windowScore(tokens, start, length);
      if (score < 0 || (best && score <= best.score)) continue;
      best = { score, start, length };
    }
  }
  if (!best) return null;
  const first = tokens[best.start];
  const last = tokens[best.start + best.length - 1];
  return {
    expression: segment.sourceText.slice(first.start, last.end),
    normalizedExpression: tokens.slice(best.start, best.start + best.length).map((token) => token.normalized).join(" "),
    segment,
    start: first.start,
    end: last.end,
  };
}

export function extractContentExpressions(segment: ContentDiscoverySegment): readonly ContentDiscoveryExpression[] {
  const tokens = tokenizeSpanish(segment.sourceText);
  const expressions: ContentDiscoveryExpression[] = [];
  for (const length of [3, 2]) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      if (windowScore(tokens, start, length) < 0) continue;
      const first = tokens[start];
      const last = tokens[start + length - 1];
      expressions.push({
        expression: segment.sourceText.slice(first.start, last.end),
        normalizedExpression: tokens.slice(start, start + length).map((token) => token.normalized).join(" "),
        segment,
        start: first.start,
        end: last.end,
      });
    }
  }
  return expressions;
}

export function discoveryContext(expression: ContentDiscoveryExpression): Readonly<{ contextBefore: string; contextAfter: string }> {
  return {
    contextBefore: expression.segment.sourceText.slice(0, expression.start).trim(),
    contextAfter: expression.segment.sourceText.slice(expression.end).trim(),
  };
}
