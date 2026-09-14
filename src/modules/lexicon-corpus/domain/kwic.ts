import { normalizeSpanishSurface, tokenizeSpanish } from "./spanish-token";
import type { SourcePosition } from "./content-reference";

export type CorpusQueryTokens = readonly string[];

export type KwicInput = Readonly<{
  surfaceText: string;
  contextBefore: string;
  contextAfter: string;
  sourceTitle: string;
  sourceKind: string;
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  sourcePosition: SourcePosition;
}>;

export type KwicResult = Readonly<{
  leftContext: string;
  keyword: string;
  rightContext: string;
  sourceTitle: string;
  sourceKind: string;
  document: Readonly<{ kind: "article" | "media"; stableKey: string; version: number }>;
  location: SourcePosition;
}>;

export function normalizeCorpusQuery(query: string): CorpusQueryTokens {
  return tokenizeSpanish(query).map((token) => token.normalized).filter(Boolean);
}

export function matchesCorpusQuery(text: string, query: CorpusQueryTokens): boolean {
  if (query.length === 0) return false;
  const haystack = new Set(tokenizeSpanish(text).map((token) => token.normalized));
  return query.every((token) => haystack.has(normalizeSpanishSurface(token)));
}

export function buildKwic(input: KwicInput): KwicResult {
  return {
    leftContext: input.contextBefore,
    keyword: input.surfaceText,
    rightContext: input.contextAfter,
    sourceTitle: input.sourceTitle,
    sourceKind: input.sourceKind,
    document: { kind: input.documentKind, stableKey: input.documentStableKey, version: input.documentVersion },
    location: input.sourcePosition,
  };
}
