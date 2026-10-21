import { normalizeSpanishSurface, tokenizeSpanish } from "./spanish-token";
import type { SourcePosition } from "./content-reference";

export type CorpusQueryTokens = readonly string[];
export type CorpusMatchMode = "phrase" | "all";

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

export function matchesCorpusQuery(text: string, query: CorpusQueryTokens, mode: CorpusMatchMode = "phrase"): boolean {
  if (query.length === 0) return false;
  const haystack = tokenizeSpanish(text).map((token) => token.normalized);
  const normalizedQuery = query.map(normalizeSpanishSurface);
  if (mode === "phrase") {
    return haystack.some((_, start) => normalizedQuery.every((token, offset) => haystack[start + offset] === token));
  }
  const tokenSet = new Set(haystack);
  return normalizedQuery.every((token) => tokenSet.has(token));
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
