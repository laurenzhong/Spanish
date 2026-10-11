import "server-only";

import { z } from "zod";

import { ownerAuthorizedReviewerReference } from "@/src/modules/content-acquisition/domain/review-identity";
import type {
  CandidateReviewDecision,
  CandidateReviewRequest,
  CandidateReviewer,
} from "@/src/modules/lexicon-corpus/application/candidate-reviewer";
import {
  lexiconReviewDimensionValues,
  type LexiconReviewOutcome,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";

import {
  MiniMaxLexiconReviewError,
  validateLexiconReviewSnapshot,
  type LexiconReviewObservation,
  type LexiconReviewObserver,
  type LexiconReviewSnapshot,
} from "./lexicon-review";

/**
 * MiniMax-backed implementation of the `CandidateReviewer` seam.
 *
 * One call answers **one** dimension of **one** frozen candidate:
 *
 * - `content-es-ES` — is the Spanish form itself correct, and is the surface
 *   form a legitimate corpus entry?
 * - `teaching-zh-CN` — is the Chinese learner-facing explanation correct and
 *   usable?
 *
 * The adapter is fail-closed by construction. Every path that does not end in a
 * Zod-validated, key-exact, untruncated payload whose named dimension matches
 * the requested one throws `MiniMaxLexiconReviewError` instead of returning a
 * decision. There is no default `pass`, no partial accept and no fallback to an
 * earlier verdict: an unparseable response can never look like approval. That
 * matters because a `pass` here is a step towards owner approval and corpus
 * indexing; the pipeline refuses `fail`/`pass` only on stored verdicts, so this
 * adapter must never manufacture one out of noise.
 *
 * What the model is *not* allowed to decide (the code checks each):
 *
 * - the outcome is read only from the literal `"pass"` / `"fail"` string;
 * - the dimension is cross-checked against the request, so a model that answers
 *   the other dimension fails the call rather than the candidate;
 * - any `confidence`-style field is ignored entirely — confidence is not a
 *   decision criterion, and the seam has no place to record one;
 * - the reviewer identity is written by this code as
 *   `dsh-ai-owner-authorized-review` and is never taken from the response. It is
 *   an AI platform review by the owner-authorised agent platform — never a human,
 *   a native speaker or a teaching expert (AGENTS.md §8).
 */

/**
 * `api.minimaxi.com` is the host this project's MiniMax key is issued for: the
 * same key returns 401 from `api.minimax.io`. `.env.example` records the
 * canonical value as `MINIMAX_API_ENDPOINT`, and the factory below reads it (as
 * the other adapters do), so a host change is configuration, not code.
 */
const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 45_000;

/**
 * 900 tokens truncated a real response mid-JSON, and the truncation surfaced as
 * "invalid format" rather than as a length problem. A single-dimension verdict is
 * small, but the budget is deliberately generous so that a chatty model cannot
 * turn a slow answer into a false rejection.
 */
const defaultMaxTokens = 4_000;

/**
 * The review identity written on every decision. Built through the shared
 * authority so this adapter cannot invent an identity the corpus gate would
 * refuse, and so the AI provenance is stated in the record itself.
 */
const reviewIdentity = ownerAuthorizedReviewerReference({ actor: "lexicon-candidate-review" });

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Clock = () => number;
type CostEstimator = (observation: Readonly<{ modelVersion: string; responseBytes: number }>) => number | null;

export type MiniMaxCandidateReviewerOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  maxTokens?: number;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
  /**
   * Optional cost estimate in micros. `null` — the default — records "unknown"
   * rather than a made-up zero, so a dashboard cannot mistake unpriced calls for
   * free ones.
   */
  estimateCostMicros?: CostEstimator;
  /**
   * Telemetry sink. Called once per call, on success and on failure. It must not
   * throw; the adapter swallows its errors either way so telemetry can never
   * change a verdict.
   */
  observe?: LexiconReviewObserver;
}>;

/**
 * A decision plus the provenance the pipeline does not need but an operator
 * does. Structurally a `CandidateReviewDecision`, so it plugs into
 * `CandidateReviewer` unchanged; the extra field is ignored by the seam and the
 * pipeline, which only ever read `dimension` / `outcome` / `reviewerReference`
 * / `reviewedAt`.
 */
export type MiniMaxCandidateReviewDecision = Readonly<
  CandidateReviewDecision & {
    /** Provider / model / latency / request id (AGENTS.md §7). No prompt, no key. */
    observation: LexiconReviewObservation;
  }
>;

/**
 * The vendor payload, validated before it is believed.
 *
 * `.strict()` is the point: an unexpected key means the model answered a
 * different question than the one asked, and guessing which key it meant is how
 * a wrong verdict reaches the corpus. A missing key, an extra key, a wrong type
 * or an out-of-range length all throw.
 */
const decisionPayloadSchema = z
  .object({
    outcome: z.enum(["pass", "fail"]),
    dimension: z.enum(lexiconReviewDimensionValues),
    languageVerdict: z.string().trim().min(1).max(400),
    teachingVerdict: z.string().trim().min(1).max(400),
    reason: z.string().trim().min(1).max(1_200),
    evidence: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
    issues: z.array(z.string().trim().min(1).max(400)).max(6),
  })
  .strict();

/** The Anthropic-compatible envelope. `stop_reason` is kept: it distinguishes truncation. */
const anthropicResponseSchema = z
  .object({
    content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()),
    stop_reason: z.string().nullable().optional(),
  })
  .passthrough();

type RequestSignal = Readonly<{
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}>;

export class MiniMaxCandidateReviewer implements CandidateReviewer {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;
  private readonly estimateCostMicros: CostEstimator | undefined;
  private readonly observe: LexiconReviewObserver | undefined;

  constructor(private readonly options: MiniMaxCandidateReviewerOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.maxTokens = options.maxTokens ?? defaultMaxTokens;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.estimateCostMicros = options.estimateCostMicros;
    this.observe = options.observe;
  }

  async review(
    input: CandidateReviewRequest,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<MiniMaxCandidateReviewDecision> {
    const dimension = input.dimension;
    const snapshot = toSnapshot(input);
    validateLexiconReviewSnapshot(snapshot);

    if (!this.options.apiKey.trim()) {
      throw new MiniMaxLexiconReviewError(
        "provider-auth-failed",
        "Lexicon candidate review is not configured.",
        false,
      );
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();
    let providerRequestId: string | null = null;
    let stopReason: string | null = null;
    let responseBytes = 0;
    let observed = false;

    /** Emit telemetry exactly once per call, whatever the path. Never throws. */
    const emit = (obs: Readonly<{ failureCode: LexiconReviewObservation["failureCode"] }>): void => {
      if (observed) return;
      observed = true;
      const latencyMs = Math.max(0, this.clock() - startedAt);
      let estimatedCostMicros: number | null = null;
      try {
        estimatedCostMicros = this.estimateCostMicros
          ? this.estimateCostMicros({ modelVersion: this.modelVersion, responseBytes })
          : null;
      } catch {
        estimatedCostMicros = null;
      }
      const observation: LexiconReviewObservation = {
        provider: "minimax",
        modelVersion: this.modelVersion,
        dimension,
        providerRequestId,
        latencyMs,
        estimatedCostMicros,
        failureCode: obs.failureCode,
        stopReason,
      };
      try {
        this.observe?.(observation);
      } catch {
        // A telemetry sink must never change a verdict in either direction.
      }
    };

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
          max_tokens: this.maxTokens,
          thinking: { type: "disabled" },
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(snapshot) }] }],
        }),
        signal: requestSignal.signal,
      });
      // Read the request id before the status check: a 429 or a 5xx is exactly
      // the case where an operator has to quote it to the vendor, and it is a
      // header, not a credential or a payload.
      providerRequestId = readRequestId(response.headers);

      if (!response.ok) throw errorForResponseStatus(response.status);

      let envelope: unknown;
      try {
        envelope = await response.json();
      } catch {
        throw invalidResponse();
      }

      const parsedResponse = anthropicResponseSchema.safeParse(envelope);
      if (!parsedResponse.success) throw invalidResponse();
      stopReason = parsedResponse.data.stop_reason ?? null;

      const text = parsedResponse.data.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      responseBytes = text.length;
      if (!text) throw invalidResponse();

      // Truncation is checked before the parse: a mid-JSON cut must be reported
      // as "too long", never as "wrong format".
      if (stopReason === "max_tokens") throw truncatedResponse();

      const decision = parseDecisionPayload(text);

      if (decision.dimension !== dimension) {
        throw new MiniMaxLexiconReviewError(
          "provider-response-invalid",
          `Lexicon review answered the "${decision.dimension}" dimension when "${dimension}" was requested.`,
          false,
        );
      }

      const outcome: LexiconReviewOutcome = decision.outcome;
      emit({ failureCode: null });

      return {
        dimension,
        outcome,
        // Code-owned identity: never the model's claim, never a human signature.
        reviewerReference: reviewIdentity,
        reviewedAt: new Date(this.clock()),
        observation: {
          provider: "minimax",
          modelVersion: this.modelVersion,
          dimension,
          providerRequestId,
          latencyMs: Math.max(0, this.clock() - startedAt),
          estimatedCostMicros: this.estimateCostMicros
            ? safeCost(this.estimateCostMicros, this.modelVersion, responseBytes)
            : null,
          failureCode: null,
          stopReason,
        },
      };
    } catch (error) {
      // Fail-closed: whatever went wrong, the caller gets an error and no verdict.
      if (error instanceof MiniMaxLexiconReviewError) {
        emit({ failureCode: error.code });
        throw error;
      }
      if (requestSignal.timedOut()) {
        const timeout = new MiniMaxLexiconReviewError(
          "provider-timeout",
          "Lexicon candidate review timed out.",
          true,
        );
        emit({ failureCode: timeout.code });
        throw timeout;
      }
      if (requestSignal.signal.aborted) {
        const cancelled = new MiniMaxLexiconReviewError(
          "provider-cancelled",
          "Lexicon candidate review was cancelled.",
          false,
        );
        emit({ failureCode: cancelled.code });
        throw cancelled;
      }
      const unavailable = new MiniMaxLexiconReviewError(
        "provider-unavailable",
        "Lexicon candidate review provider is temporarily unavailable.",
        true,
      );
      emit({ failureCode: unavailable.code });
      throw unavailable;
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createMiniMaxCandidateReviewer(
  options: Omit<MiniMaxCandidateReviewerOptions, "apiKey"> &
    Partial<Pick<MiniMaxCandidateReviewerOptions, "apiKey">> = {},
): MiniMaxCandidateReviewer {
  return new MiniMaxCandidateReviewer({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    // Same resolution order as the other MiniMax adapters.
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
  });
}

/** The identity this adapter writes; exported so a caller/test can assert it. */
export const lexiconReviewIdentity = reviewIdentity;

/** Which dimension this adapter is currently answering. Exposed for smoke tooling. */
export const lexiconReviewDimensions = lexiconReviewDimensionValues;

/**
 * The prompt names the exact JSON keys and shows one complete example.
 *
 * This is a hard requirement, not style. Two adapters in this repo were broken by
 * prompts that described field *semantics* without naming keys: the extraction
 * model answered `pos` / `id` / `type` / `clue` and the strict schema rejected
 * every payload. Describing the meaning of a field does not make the model emit
 * that field's name, so the key list and a filled-in example both appear below.
 *
 * Note what the prompt deliberately does not ask for: no confidence number (it is
 * not a decision criterion and has nowhere to go), and no reviewer identity —
 * identity is written by code, never by the model.
 */
const systemPrompt = [
  "You review one candidate for a Spanish learning corpus, for the project owner to approve or reject.",
  "This is review, not authorship: judge only the candidate and the frozen context you are given, and never invent facts that the given text does not support.",
  "You are an AI review step on the owner-authorised agent platform; you are not a human, a native speaker or a teaching expert, and you must not claim to be one.",
  "You answer exactly one dimension per call, named in the request payload as dimension.",
  "Answering content-es-ES: use pass only when the surface form occurs in the frozen context, the part of speech fits the way the form is used there, a lexeme's lemma is its dictionary form for that use, and a phrase is a complete, learner-usable unit of the text provided.",
  "Answering content-es-ES: use fail when any of that is wrong, when the form is not in the context, or when the context is not enough to judge.",
  "Answering teaching-zh-CN: use pass only when meaningZh is an accurate Chinese rendering of the Spanish, the wording is clear, and the register suits a learner without false claims.",
  "Answering teaching-zh-CN: use fail when meaningZh is missing, misleading, or wrong in register, or when you cannot verify it from the given text.",
  "Judge only the named dimension: a problem outside it does not change this outcome.",
  "Confidence is not part of this decision; do not output any confidence score.",
  "When in doubt, answer fail. An unverified pass sends the candidate towards owner approval and indexing, so an unsure pass is the expensive mistake.",
  "Return JSON only, with no markdown fence and no commentary.",
  "Your JSON object must carry exactly these seven keys and no others: " +
    "outcome, dimension, languageVerdict, teachingVerdict, reason, evidence, issues.",
  'outcome is the string "pass" or the string "fail". dimension is exactly the string you were asked for.',
  "languageVerdict, teachingVerdict and reason are strings: one sentence each for the two verdict summaries, then the reason for this outcome.",
  "evidence is an array of at least one string quoting what in the candidate or context supports the outcome.",
  'issues is an array of strings, empty when there is nothing to flag: {"issues":[]}.',
  "Every key must be present on every response, including issues when it is empty.",
  "The exact shape, for dimension content-es-ES, is: " +
    '{"outcome":"pass","dimension":"content-es-ES","languageVerdict":"The surface form occurs in the context and is used as a noun.","teachingVerdict":"The Chinese explanation matches the Spanish meaning.","reason":"The candidate form, part of speech and explanation are all supported by the frozen context.","evidence":["... un terremoto de magnitud 7.2 ..."],"issues":[]}',
  'The exact shape, for dimension teaching-zh-CN, is: ' +
    '{"outcome":"fail","dimension":"teaching-zh-CN","languageVerdict":"The Spanish form is used correctly as a noun.","teachingVerdict":"The Chinese explanation omits part of the meaning.","reason":"The explanation is incomplete against the Spanish, so a learner would be misled.","evidence":["meaningZh: 地震"],"issues":["The explanation does not cover the magnitude phrase."]}',
].join(" ");

function buildPrompt(snapshot: LexiconReviewSnapshot): string {
  return JSON.stringify({
    task: "review_lexicon_candidate",
    dimension: snapshot.dimension,
    candidate: {
      id: snapshot.candidateId,
      kind: snapshot.kind,
      surfaceText: snapshot.surfaceText,
      normalizedText: snapshot.normalizedText,
      lemma: snapshot.lemma,
      partOfSpeech: snapshot.partOfSpeech,
      meaningZh: snapshot.meaningZh,
    },
    frozenContext: {
      documentKind: snapshot.documentKind,
      documentStableKey: snapshot.documentStableKey,
      documentVersion: snapshot.documentVersion,
      segmentIndex: snapshot.segmentIndex,
      contextBefore: snapshot.contextBefore,
      contextAfter: snapshot.contextAfter,
    },
    constraints: {
      oneDimensionPerCall: true,
      confidenceIsNotADecisionCriterion: true,
      ownerApprovalRequired: true,
      writesEvidence: false,
      affectsMastery: false,
      affectsConfidence: false,
      audioIncluded: false,
    },
  });
}

/** Build the prompt input from the frozen candidate. The request dimension wins. */
function toSnapshot(input: CandidateReviewRequest): LexiconReviewSnapshot {
  const { candidate } = input;
  return {
    candidateId: candidate.id,
    kind: candidate.kind,
    dimension: input.dimension,
    surfaceText: candidate.surfaceText,
    normalizedText: candidate.normalizedText,
    lemma: candidate.lemma,
    partOfSpeech: candidate.partOfSpeech,
    meaningZh: candidate.meaningZh,
    documentKind: candidate.source.documentKind,
    documentStableKey: candidate.source.documentStableKey,
    documentVersion: candidate.source.documentVersion,
    segmentIndex: candidate.source.segmentIndex,
    contextBefore: candidate.source.contextBefore,
    contextAfter: candidate.source.contextAfter,
  };
}

/** Strip an optional markdown fence, parse, and validate against the strict schema. */
function parseDecisionPayload(text: string): z.infer<typeof decisionPayloadSchema> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw invalidResponse();
  }
  const parsed = decisionPayloadSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): MiniMaxLexiconReviewError {
  return new MiniMaxLexiconReviewError(
    "provider-response-invalid",
    "Lexicon review response did not match the expected format.",
    false,
  );
}

/**
 * `stop_reason: "max_tokens"` means the payload was cut mid-JSON. Reported as its
 * own code because the remedy is a larger budget (or a smaller candidate), and it
 * is retryable: the same request with a bigger budget can succeed.
 */
function truncatedResponse(): MiniMaxLexiconReviewError {
  return new MiniMaxLexiconReviewError(
    "provider-response-truncated",
    "Lexicon review response was truncated before the verdict was complete.",
    true,
  );
}

/**
 * The vendor request id, under whichever name this endpoint uses.
 *
 * A real call to `api.minimaxi.com/anthropic/v1/messages` returns
 * `x-mm-request-id` and `trace-id`, and **no** `x-request-id`; the other MiniMax
 * adapters read only `x-request-id`, so they record `null` on every successful
 * call. AGENTS.md §7 requires the request id, so all three names are accepted,
 * most specific first.
 */
function readRequestId(headers: Headers): string | null {
  for (const name of ["x-request-id", "x-mm-request-id", "trace-id"]) {
    const value = headers.get(name);
    if (value?.trim()) return value.trim();
  }
  return null;
}

function errorForResponseStatus(status: number): MiniMaxLexiconReviewError {
  if (status === 401 || status === 403) {
    return new MiniMaxLexiconReviewError("provider-auth-failed", "Lexicon review authentication failed.", false);
  }
  if (status === 429) {
    return new MiniMaxLexiconReviewError("provider-rate-limited", "Lexicon review rate limit was reached.", true);
  }
  if (status >= 500) {
    return new MiniMaxLexiconReviewError("provider-unavailable", "Lexicon review provider is unavailable.", true);
  }
  return invalidResponse();
}

function safeCost(
  estimate: CostEstimator,
  modelVersion: string,
  responseBytes: number,
): number | null {
  try {
    const value = estimate({ modelVersion, responseBytes });
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  } catch {
    return null;
  }
}

/**
 * One signal for the call: the caller's cancellation, plus this adapter's own
 * timeout. Mirrors `createRequestSignal` in the extraction adapter so the two
 * behave identically under abort.
 */
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
