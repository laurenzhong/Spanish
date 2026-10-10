import "server-only";

import { z } from "zod";

import {
  LexiconExtractionError,
  isLexiconPartOfSpeech,
  validateLexiconCandidateProposals,
  validateLexiconExtractionInput,
  type LexemeCandidateProvider,
  type LexiconCandidateProposal,
  type LexiconExtractionInput,
  type LexiconExtractionResult,
} from "./lexicon-extraction";

/**
 * MiniMax-backed lexeme/phrase extraction.
 *
 * Only segment text is sent. The provider proposes candidates; it cannot approve
 * them, cannot write evidence, and cannot reach the corpus (ADR-0011).
 *
 * The model's claims are treated as untrusted input: a proposal whose surface
 * form does not actually occur in the segment it cites is dropped, and a part
 * of speech outside the controlled set is discarded rather than stored.
 */

// `api.minimaxi.com` is the endpoint this project's MiniMax key is issued for:
// the same key returns 401 from `api.minimax.io`. Every current MiniMax adapter
// here uses this host (conversation, scenario-*, story-generation, translation,
// word-explanation); `annotation/minimax-annotation.ts` still carries the older
// `.io` host and is the one place that disagrees.
const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 60_000;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Clock = () => number;

export type MiniMaxLexiconExtractionProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
}>;

type RequestSignal = Readonly<{
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}>;

const proposalSchema = z
  .object({
    kind: z.enum(["lexeme", "phrase"]),
    surfaceText: z.string().trim().min(1).max(500),
    lemma: z.string().trim().min(1).max(120).nullable(),
    partOfSpeech: z.string().trim().min(1).max(20).nullable(),
    meaningZh: z.string().trim().min(1).max(500).nullable(),
    segmentIndex: z.number().int().min(0),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const extractionPayloadSchema = z
  .object({
    proposals: z.array(proposalSchema).max(2_000),
  })
  .strict();

const anthropicResponseSchema = z
  .object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()),
  })
  .passthrough();

export class MiniMaxLexiconExtractionProvider implements LexemeCandidateProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxLexiconExtractionProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async extractCandidates(
    input: LexiconExtractionInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<LexiconExtractionResult> {
    validateLexiconExtractionInput(input);
    if (!this.options.apiKey.trim()) {
      throw new LexiconExtractionError("provider-auth-failed", "Lexicon extraction is not configured.", false);
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 4_000,
          thinking: { type: "disabled" },
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
        }),
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id");

      if (!response.ok) throw errorForResponseStatus(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse();
      }

      const parsedResponse = anthropicResponseSchema.safeParse(payload);
      if (!parsedResponse.success || parsedResponse.data.content.length === 0) throw invalidResponse();
      const text = parsedResponse.data.content.map((block) => block.text).join("\n");
      const parsed = parseExtractionPayload(text);

      const proposals = sanitizeProposals(parsed.proposals, input);
      validateLexiconCandidateProposals(proposals, input.segments);

      return {
        proposals,
        safety: {
          audioSent: false,
          writesEvidence: false,
          affectsMastery: false,
          affectsConfidence: false,
          needsOwnerApproval: true,
        },
        provider: "minimax",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
      };
    } catch (error) {
      if (error instanceof LexiconExtractionError) throw error;
      if (requestSignal.timedOut()) {
        throw new LexiconExtractionError("provider-timeout", "Lexicon extraction timed out.", true);
      }
      if (requestSignal.signal.aborted) {
        throw new LexiconExtractionError("provider-cancelled", "Lexicon extraction was cancelled.", false);
      }
      throw new LexiconExtractionError(
        "provider-unavailable",
        "Lexicon extraction provider is temporarily unavailable.",
        true,
      );
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createMiniMaxLexiconExtractionProvider(
  options: Omit<MiniMaxLexiconExtractionProviderOptions, "apiKey"> &
    Partial<Pick<MiniMaxLexiconExtractionProviderOptions, "apiKey">> = {},
): MiniMaxLexiconExtractionProvider {
  return new MiniMaxLexiconExtractionProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
  });
}

/**
 * The prompt states the exact wire shape, not just the field semantics.
 *
 * This matters: an earlier version described what each field meant but never
 * showed the JSON, and the model answered with `pos` instead of
 * `partOfSpeech`, omitted `kind` and `segmentIndex`, and added an `example`
 * key. The strict schema then rejected the whole payload. Naming the fields in
 * a concrete example is what makes the contract land.
 */
const systemPrompt = [
  "You propose vocabulary candidates for a Spanish learning corpus, for a human owner to approve.",
  "Use only the supplied segment text. Never invent words, translations or meanings that are not supported by it.",
  "For a lexeme, set lemma to the dictionary form of the surface form, and set meaningZh to null.",
  "For a phrase, copy the whole sentence as surfaceText, set meaningZh to its Chinese translation from the segment, and set lemma to null.",
  "Use only these part-of-speech tags, or null when unsure: ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN SCONJ VERB.",
  "Prefer content words a learner would study; skip pure function words and numbers.",
  "Every proposal is a suggestion pending owner approval, so set confidence honestly.",
  "Return JSON only, with no markdown fence and no commentary.",
  "Every proposal object must carry exactly these seven keys and no others: " +
    'kind, surfaceText, lemma, partOfSpeech, meaningZh, segmentIndex, confidence.',
  "kind is either the string \"lexeme\" or the string \"phrase\". segmentIndex is the integer index of the segment the proposal came from.",
  'The exact shape is: {"proposals":[{"kind":"lexeme","surfaceText":"terremoto","lemma":"terremoto","partOfSpeech":"NOUN","meaningZh":null,"segmentIndex":0,"confidence":0.97}]}',
].join(" ");

function buildPrompt(input: LexiconExtractionInput): string {
  return JSON.stringify({
    task: "propose_lexicon_candidates",
    language: input.language,
    maxCandidatesPerSegment: input.maxCandidatesPerSegment,
    segments: input.segments.map((segment) => ({
      segmentIndex: segment.segmentIndex,
      documentKind: segment.documentKind,
      sourceText: segment.sourceText,
      translation: segment.translation,
    })),
    constraints: {
      audioIncluded: false,
      writeEvidence: false,
      updateMastery: false,
      updateConfidence: false,
      ownerApprovalRequired: true,
    },
  });
}

type RawProposal = z.infer<typeof proposalSchema>;

/**
 * Drop claims the text cannot support, and enforce the caller's bound.
 *
 * A hallucinated surface form is the failure mode that matters most here: if the
 * word is not in the segment, the candidate would create a corpus occurrence
 * pointing at text that does not contain it.
 */
function sanitizeProposals(
  raw: readonly RawProposal[],
  input: LexiconExtractionInput,
): readonly LexiconCandidateProposal[] {
  const byIndex = new Map(input.segments.map((segment) => [segment.segmentIndex, segment]));
  const perSegment = new Map<number, number>();
  const kept: LexiconCandidateProposal[] = [];

  for (const proposal of raw) {
    const segment = byIndex.get(proposal.segmentIndex);
    if (!segment) continue;

    // The cited surface form must occur in the cited segment.
    if (!segment.sourceText.toLocaleLowerCase("es").includes(proposal.surfaceText.toLocaleLowerCase("es"))) continue;

    // A lexeme with a phrase translation, or a phrase with a lemma, is malformed.
    if (proposal.kind === "lexeme" && proposal.meaningZh !== null) continue;
    if (proposal.kind === "phrase" && proposal.lemma !== null) continue;

    const used = perSegment.get(proposal.segmentIndex) ?? 0;
    if (used >= input.maxCandidatesPerSegment) continue;

    // An unrecognised tag is discarded rather than stored as fact.
    const partOfSpeech =
      proposal.partOfSpeech !== null && isLexiconPartOfSpeech(proposal.partOfSpeech) ? proposal.partOfSpeech : null;

    perSegment.set(proposal.segmentIndex, used + 1);
    kept.push({
      kind: proposal.kind,
      surfaceText: proposal.surfaceText,
      normalizedText: proposal.surfaceText.toLocaleLowerCase("es"),
      lemma: proposal.kind === "lexeme" ? proposal.lemma : null,
      partOfSpeech,
      meaningZh: proposal.kind === "phrase" ? proposal.meaningZh : null,
      segmentIndex: proposal.segmentIndex,
      confidence: proposal.confidence,
    });
  }

  return kept;
}

function parseExtractionPayload(text: string): z.infer<typeof extractionPayloadSchema> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw invalidResponse();
  }
  const parsed = extractionPayloadSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): LexiconExtractionError {
  return new LexiconExtractionError(
    "provider-response-invalid",
    "Lexicon extraction provider response did not match the expected format.",
    false,
  );
}

function errorForResponseStatus(status: number): LexiconExtractionError {
  if (status === 401 || status === 403) {
    return new LexiconExtractionError("provider-auth-failed", "Lexicon extraction authentication failed.", false);
  }
  if (status === 429) {
    return new LexiconExtractionError("provider-rate-limited", "Lexicon extraction rate limit was reached.", true);
  }
  if (status >= 500) {
    return new LexiconExtractionError("provider-unavailable", "Lexicon extraction provider is unavailable.", true);
  }
  return invalidResponse();
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): RequestSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}
