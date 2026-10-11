/**
 * Lexeme/phrase extraction provider.
 *
 * The provider turns frozen, already-published content segments into
 * *candidate proposals*. It is deliberately narrow:
 *
 * - it receives text only, never audio, and never a user's private data;
 * - it returns proposals, not corpus rows — assembling a `LexiconCandidate`
 *   (id, revision, status, reviews) belongs to the application layer;
 * - it cannot approve anything, so extraction alone can never reach the corpus
 *   (ADR-0011);
 * - its output is always `needsOwnerApproval: true`.
 */

export const lexiconExtractionErrorCodes = [
  "input-invalid",
  "provider-auth-failed",
  "provider-rate-limited",
  "provider-timeout",
  "provider-cancelled",
  "provider-unavailable",
  "provider-response-invalid",
] as const;

export type LexiconExtractionErrorCode = (typeof lexiconExtractionErrorCodes)[number];

export const lexiconCandidateKinds = ["lexeme", "phrase"] as const;
export type LexiconCandidateKind = (typeof lexiconCandidateKinds)[number];

/** One frozen segment. Version is pinned so a later content edit cannot move it. */
export type LexiconExtractionSegment = Readonly<{
  documentKind: "article" | "media";
  documentStableKey: string;
  documentVersion: number;
  segmentIndex: number;
  /** Spanish source text of the segment. */
  sourceText: string;
  /** Chinese translation, when the published version carries one. */
  translation: string | null;
  sourceTitle: string;
  sourceKind: string;
}>;

export type LexiconExtractionInput = Readonly<{
  /** Study language of the content. Only `es` is supported today. */
  language: string;
  segments: readonly LexiconExtractionSegment[];
  /** Bounds provider work per call; the application layer sets this from quota. */
  maxCandidatesPerSegment: number;
}>;

/**
 * A proposal. Everything here is *untrusted* until both review dimensions pass
 * and an owner approves; `partOfSpeech` in particular is a provider claim.
 */
export type LexiconCandidateProposal = Readonly<{
  kind: LexiconCandidateKind;
  /** Surface form exactly as it appears in the segment. */
  surfaceText: string;
  normalizedText: string;
  /** Lexeme-only. */
  lemma: string | null;
  /** Lexeme-only; must be from the controlled set or null when unknown. */
  partOfSpeech: string | null;
  /** Phrase-only learner-facing translation. */
  meaningZh: string | null;
  /** Index of the segment this proposal came from. */
  segmentIndex: number;
  /** Provider confidence in `[0, 1]`; informational, never a publication gate. */
  confidence: number;
}>;

export type LexiconExtractionResult = Readonly<{
  proposals: readonly LexiconCandidateProposal[];
  safety: Readonly<{
    audioSent: false;
    writesEvidence: false;
    affectsMastery: false;
    affectsConfidence: false;
    /** Always true: proposals are never publishable without owner approval. */
    needsOwnerApproval: true;
  }>;
  provider: "minimax" | "fake";
  modelVersion: string;
  providerRequestId: string | null;
  latencyMs: number;
  estimatedCostMicros: number | null;
}>;

export interface LexemeCandidateProvider {
  extractCandidates(
    input: LexiconExtractionInput,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<LexiconExtractionResult>;
}

export class LexiconExtractionError extends Error {
  readonly code: LexiconExtractionErrorCode;
  readonly retryable: boolean;

  constructor(code: LexiconExtractionErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "LexiconExtractionError";
    this.code = code;
    this.retryable = retryable;
  }
}

/** Parts of speech the corpus accepts. A provider claim outside this set is dropped. */
export const lexiconPartOfSpeechValues = [
  "ADJ",
  "ADP",
  "ADV",
  "AUX",
  "CCONJ",
  "DET",
  "INTJ",
  "NOUN",
  "NUM",
  "PART",
  "PRON",
  "PROPN",
  "SCONJ",
  "VERB",
] as const;

export type LexiconPartOfSpeech = (typeof lexiconPartOfSpeechValues)[number];

export function isLexiconPartOfSpeech(value: string): value is LexiconPartOfSpeech {
  return (lexiconPartOfSpeechValues as readonly string[]).includes(value);
}

/**
 * Reject the request before any provider is called. Fail-closed: a bad batch
 * must not silently produce a partial corpus.
 */
export function validateLexiconExtractionInput(input: LexiconExtractionInput): void {
  if (input.language !== "es") {
    throw new LexiconExtractionError("input-invalid", "Only es content can be indexed.", false);
  }
  if (!Number.isInteger(input.maxCandidatesPerSegment) || input.maxCandidatesPerSegment < 1) {
    throw new LexiconExtractionError("input-invalid", "Candidate bound must be a positive integer.", false);
  }
  for (const segment of input.segments) {
    if (!segment.documentStableKey.trim() || !segment.sourceText.trim()) {
      throw new LexiconExtractionError("input-invalid", "Extraction segment is incomplete.", false);
    }
    if (!Number.isInteger(segment.documentVersion) || segment.documentVersion < 1) {
      throw new LexiconExtractionError("input-invalid", "Segment document version is invalid.", false);
    }
    if (!Number.isInteger(segment.segmentIndex) || segment.segmentIndex < 0) {
      throw new LexiconExtractionError("input-invalid", "Segment index is invalid.", false);
    }
  }
}

/**
 * Validate a provider response before it is trusted. Anything malformed fails
 * the whole batch rather than yielding a partially-believed candidate set.
 */
export function validateLexiconCandidateProposals(
  proposals: readonly LexiconCandidateProposal[],
  segments: readonly LexiconExtractionSegment[],
): void {
  const indexes = new Set(segments.map((segment) => segment.segmentIndex));
  for (const proposal of proposals) {
    if (!proposal.surfaceText.trim() || !proposal.normalizedText.trim()) {
      throw new LexiconExtractionError("provider-response-invalid", "Proposal text is empty.", false);
    }
    if (!indexes.has(proposal.segmentIndex)) {
      throw new LexiconExtractionError(
        "provider-response-invalid",
        "Proposal references a segment outside the request.",
        false,
      );
    }
    // Both kinds carry a Chinese gloss, and a lexeme's gloss is not incidental:
    // the `teaching-zh-CN` review dimension judges it, and the vocabulary view
    // renders it. A lexeme without one cannot be approved, so it is refused here
    // rather than being carried to a review that is guaranteed to fail.
    if (proposal.meaningZh === null || !proposal.meaningZh.trim()) {
      throw new LexiconExtractionError(
        "provider-response-invalid",
        "Every proposal must carry a Chinese gloss of its meaning.",
        false,
      );
    }
    if (proposal.kind === "lexeme" && proposal.lemma === null) {
      throw new LexiconExtractionError(
        "provider-response-invalid",
        "A lexeme proposal must carry its dictionary form as the lemma.",
        false,
      );
    }
    if (proposal.kind === "phrase" && proposal.lemma !== null) {
      throw new LexiconExtractionError(
        "provider-response-invalid",
        "A phrase proposal must not carry a lemma.",
        false,
      );
    }
    if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
      throw new LexiconExtractionError("provider-response-invalid", "Proposal confidence is out of range.", false);
    }
    if (proposal.partOfSpeech !== null && !isLexiconPartOfSpeech(proposal.partOfSpeech)) {
      throw new LexiconExtractionError(
        "provider-response-invalid",
        "Proposal part of speech is outside the controlled set.",
        false,
      );
    }
  }
}
