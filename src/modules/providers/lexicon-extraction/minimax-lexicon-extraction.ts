import "server-only";

import { z } from "zod";

import { tokenizeSpanish } from "@/src/modules/lexicon-corpus/domain/spanish-token";

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
 * form does not actually occur in the segment it cites — as whole tokens, never
 * as a substring of a longer word — is dropped, and a part of speech outside the
 * controlled set is discarded rather than stored.
 */

/**
 * `api.minimaxi.com` is the host this project's MiniMax key is issued for: the
 * same key returns 401 from `api.minimax.io`. `.env.example` records the
 * canonical value as `MINIMAX_API_ENDPOINT`, and most adapters here (ten of
 * them) read that variable, so this one does too rather than pinning a host.
 *
 * `annotation/minimax-annotation.ts` still hard-codes the older `.io` host and
 * does not read the variable at all, which is the one place that disagrees and
 * is very likely broken for the same reason this adapter was.
 */
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
      const providerRequestId = readRequestId(response.headers);

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
    // Same resolution order as the other MiniMax adapters, so a host change is a
    // configuration change rather than a code change.
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

/**
 * The request id the vendor actually returns.
 *
 * This host answers with `x-mm-request-id` (and `trace-id`, `x-session-id`,
 * `alb_request_id`) and **no** `x-request-id`. Reading only `x-request-id`
 * therefore recorded `null` on every successful call, which left the request-id
 * requirement in AGENTS.md section 7 unmet and made a vendor-side investigation
 * impossible. Names are tried most specific first.
 */
function readRequestId(headers: Headers): string | null {
  for (const name of ["x-mm-request-id", "trace-id", "x-request-id"]) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

/**
 * The prompt states the exact wire shape, not just the field semantics.
 *
 * This matters: an earlier version described what each field meant but never
 * showed the JSON, and the model answered with `pos` instead of
 * `partOfSpeech`, omitted `kind` and `segmentIndex`, and added an `example`
 * key. The strict schema then rejected the whole payload. Naming the fields in
 * a concrete example is what makes the contract land.
 *
 * The gloss requirement is stated just as plainly, and for the same reason. This
 * prompt used to ask for `meaningZh: null` on every lexeme, which was accurate
 * to the old contract and fatal to the pipeline: the `teaching-zh-CN` dimension
 * judges the gloss, so every lexeme was guaranteed to fail it and nothing could
 * ever be approved. A prompt that omits a field the review requires is a
 * contradiction between two contracts, and it belongs in the prompt where the
 * model can satisfy it.
 */
const systemPrompt = [
  "You propose vocabulary candidates for a Spanish learning corpus, for a human owner to approve.",
  "Use only the supplied segment text. Never invent words, translations or meanings that are not supported by it.",
  "Every proposal needs a Chinese gloss in meaningZh. It is what a Chinese-speaking learner reads, and a separate teaching review checks it, so never leave it null and never translate loosely.",
  "For a lexeme, set lemma to the dictionary form of the surface form, and set meaningZh to the Chinese meaning of that dictionary form — short, as a dictionary entry would give it, not a sentence.",
  "For a phrase, copy the whole sentence as surfaceText, set meaningZh to its Chinese translation, and set lemma to null.",
  "Use only these part-of-speech tags, or null when unsure: ADJ ADP ADV AUX CCONJ DET INTJ NOUN NUM PART PRON PROPN SCONJ VERB.",
  "Prefer content words a learner would study; skip pure function words and numbers.",
  "Every proposal is a suggestion pending owner approval, so set confidence honestly.",
  "Return JSON only, with no markdown fence and no commentary.",
  "Every proposal object must carry exactly these seven keys and no others: " +
    'kind, surfaceText, lemma, partOfSpeech, meaningZh, segmentIndex, confidence.',
  "kind is either the string \"lexeme\" or the string \"phrase\". segmentIndex is the integer index of the segment the proposal came from.",
  'The exact shape is: {"proposals":[{"kind":"lexeme","surfaceText":"terremoto","lemma":"terremoto","partOfSpeech":"NOUN","meaningZh":"地震","segmentIndex":0,"confidence":0.97}]}',
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
/**
 * Whether the cited form occurs in the segment as whole tokens.
 *
 * A substring test is not enough, and this is the same defect family as the
 * reviewer payload: `droide` occurs inside `droides`, so a proposal that is not
 * a token of the text passed as present and would have created a corpus
 * occurrence for a form the segment never uses. Comparing token runs gives the
 * boundary for free: a one-token form must equal a token, and a phrase must be a
 * contiguous run of them (punctuation and spacing between tokens are ignored,
 * which is what makes "un terremoto" and "¿Qué haces?" work).
 *
 * The comparison stays case-insensitive and accent-sensitive, exactly as the
 * substring check was: folding accents would accept `cafe` for `café`, which is
 * a different word from the one the text uses.
 */
function occursAsWholeTokens(segmentText: string, form: string): boolean {
  const wanted = tokenizeSpanish(form).map((token) => token.surface.toLocaleLowerCase("es"));
  if (wanted.length === 0) return false;
  const tokens = tokenizeSpanish(segmentText).map((token) => token.surface.toLocaleLowerCase("es"));
  for (let start = 0; start + wanted.length <= tokens.length; start += 1) {
    if (wanted.every((token, offset) => tokens[start + offset] === token)) return true;
  }
  return false;
}

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

    // The cited surface form must occur in the cited segment, as whole tokens.
    if (!occursAsWholeTokens(segment.sourceText, proposal.surfaceText)) continue;

    // Every candidate needs a Chinese gloss. For a phrase that gloss is its
    // translation; for a lexeme it is the meaning the teaching review judges and
    // the vocabulary view renders. A lexeme arriving without one is dropped
    // here rather than carried to a review that is guaranteed to reject it —
    // dropping costs nothing, while requesting a verdict would cost a call.
    if (proposal.meaningZh === null || !proposal.meaningZh.trim()) continue;

    // A lexeme is useless without its dictionary form, for the same reason.
    if (proposal.kind === "lexeme" && (proposal.lemma === null || !proposal.lemma.trim())) continue;

    // A phrase carrying a lemma is malformed.
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
      // Kept for both kinds: a lexeme's gloss is what the teaching dimension
      // reviews, so discarding it would guarantee that dimension fails.
      meaningZh: proposal.meaningZh,
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
