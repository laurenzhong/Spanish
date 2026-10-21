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
  normalizeReviewEvidence,
  normalizeReviewIssues,
  normalizeReviewReason,
} from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";

import {
  MiniMaxLexiconReviewError,
  createLinearBackoff,
  createSleep,
  validateLexiconReviewSnapshot,
  type LexiconReviewBackoff,
  type LexiconReviewErrorCode,
  type LexiconReviewObservation,
  type LexiconReviewObserver,
  type LexiconReviewRetryHook,
  type LexiconReviewSleep,
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
 * ## Retry, and why it is not a loosening
 *
 * Real canary runs on published articles failed roughly one time in three with
 * `provider-response-invalid`: the model is non-deterministic, so the same frozen
 * candidate and prompt occasionally come back in a shape the strict schema
 * refuses. The fix is a bounded second (and third) call — never a relaxed parse.
 * Each attempt runs the identical validation; a retry only changes *when* the
 * question is asked, never *what counts as an answer*. When the budget runs out
 * the last failure is rethrown, so exhausting retries still cannot yield `pass`.
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
 * Retry defaults.
 *
 * Three attempts in total (the first call plus two retries) is the smallest
 * budget that fixes the observed flake: a run that failed about once in three
 * becomes roughly one in twenty-seven if the failures are independent, while a
 * permanently broken prompt still stops after three calls instead of looping.
 * Two would leave no margin for a second flake in the same run; more than three
 * multiplies spend for a failure mode that is already rare.
 */
const defaultMaxAttempts = 3;
/**
 * A truncated answer gets more room on the next attempt rather than the same
 * room: re-asking with an identical budget truncates identically. Capped so one
 * candidate cannot request an unbounded completion.
 */
const defaultTruncatedMaxTokens = 8_000;
/** Base delay for the default linear-jittered backoff: ~500ms, then ~1000ms. */
const defaultBackoffMs = 500;
/**
 * Never start an attempt with less than this left in the wall-clock budget: a
 * sub-second window cannot complete, so spending a paid call on it would be pure
 * waste. The attempt is skipped and the last failure is rethrown.
 */
const minAttemptBudgetMs = 1_000;
/**
 * Headroom multiplier for the default wall-clock budget.
 *
 * The budget must leave room for retries, or the retry policy would be decorative:
 * with `totalTimeoutMs === timeoutMs`, a single attempt that took the full
 * per-attempt timeout consumes the entire budget and no retry can ever fit.
 * `totalTimeoutMs` therefore defaults to `maxAttempts × timeoutMs`, which bounds
 * the worst case at three full attempts plus backoff (~137s with the defaults)
 * while keeping each attempt's ceiling at `timeoutMs`. The budget is still
 * shared, so a *fast* failure leaves the retries their full per-attempt window
 * instead of a shrinking slice of it.
 */
const totalBudgetMultiplier = 3;

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
   * Telemetry sink. Called once per `review()` call — not once per HTTP attempt,
   * which the observation's `attempts` field reports — on success and on failure.
   * It must not throw; the adapter swallows its errors either way so telemetry can
   * never change a verdict.
   */
  observe?: LexiconReviewObserver;
  /**
   * Total HTTP attempts allowed for one `review()` call, including the first.
   * Default 3. Clamped to `[1, 5]`: a caller cannot configure an unbounded loop
   * over a paid endpoint, and an unusable value falls back to 1 (no retry).
   */
  maxAttempts?: number;
  /**
   * Wall-clock budget shared by **all** attempts of one call, in milliseconds.
   * Defaults to `timeoutMs` (45s), so the worst case stays bounded no matter how
   * many attempts are configured. Each attempt gets its own cancellation signal
   * carrying the remaining budget; the wait between attempts is carved out of the
   * same budget, and an attempt that cannot fit is not made at all.
   */
  totalTimeoutMs?: number;
  /** Completion budget used from the attempt after a truncation. Default 8000. */
  truncatedMaxTokens?: number;
  /** Base delay in ms for the default linear-jittered backoff. Default 500. */
  backoffMs?: number;
  /** Replaces the default linear-jittered backoff. */
  backoff?: LexiconReviewBackoff;
  /** Replaces the default sleep. Inject in tests so no test ever waits. */
  sleep?: LexiconReviewSleep;
  /** Called before each backoff. `null` declines the retry and rethrows the failure. */
  onRetry?: LexiconReviewRetryHook;
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
    /** Provider / model / latency / request id / attempts (AGENTS.md §7). No prompt, no key. */
    observation: LexiconReviewObservation;
  }
>;

/**
 * The vendor payload, validated before it is believed.
 *
 * `.strict()` is the point: an unexpected key means the model answered a
 * different question than the one asked, and guessing which key it meant is how
 * a wrong verdict reaches the corpus. A missing key, an extra key, a wrong type
 * or an out-of-range length all throw — on every attempt, retry or not.
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

/** One attempt's outcome, kept so the final observation can report the whole call. */
type AttemptResult =
  | Readonly<{
      ok: true;
      decision: z.infer<typeof decisionPayloadSchema>;
      /**
       * The reviewer's explanation, assembled for storage. Built from the
       * payload's prose fields, and **never** read back to decide anything: the
       * verdict travels separately in `decision.outcome`.
       */
      reason: string | null;
      providerRequestId: string | null;
      stopReason: string | null;
      responseBytes: number;
    }>
  | Readonly<{
      ok: false;
      error: MiniMaxLexiconReviewError;
      providerRequestId: string | null;
      stopReason: string | null;
      responseBytes: number;
    }>;

/**
 * Attempt limits, normalised once so the loop below reads a single number.
 *
 * `maxAttempts` is clamped rather than trusted: the point of the budget is that a
 * caller cannot accidentally configure an unbounded loop over a paid endpoint. An
 * unusable value degrades to "no retry", which is the safe direction.
 */
function normalizeMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, 5);
}

export class MiniMaxCandidateReviewer implements CandidateReviewer {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly truncatedMaxTokens: number;
  private readonly backoff: LexiconReviewBackoff;
  private readonly sleep: LexiconReviewSleep;
  private readonly onRetry: LexiconReviewRetryHook | undefined;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;
  private readonly estimateCostMicros: CostEstimator | undefined;
  private readonly observe: LexiconReviewObserver | undefined;
  /** Attempts spent so far, across every `review()` call on this instance. */
  private attemptsSpent = 0;
  /** Set while the loop retries a truncation, so the next attempt asks for more. */
  private lastFailureWasTruncated = false;

  constructor(private readonly options: MiniMaxCandidateReviewerOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.maxTokens = options.maxTokens ?? defaultMaxTokens;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    // Shared by every attempt, with room for the retries to actually happen; see
    // `totalBudgetMultiplier`. A caller who needs a tighter SLA can set it
    // explicitly — at the cost of skipping retries near the deadline.
    this.totalTimeoutMs = options.totalTimeoutMs ?? this.timeoutMs * totalBudgetMultiplier;
    this.maxAttempts = normalizeMaxAttempts(options.maxAttempts ?? defaultMaxAttempts);
    this.truncatedMaxTokens = options.truncatedMaxTokens ?? defaultTruncatedMaxTokens;
    this.backoff = options.backoff ?? createLinearBackoff(options.backoffMs ?? defaultBackoffMs);
    this.sleep = options.sleep ?? createSleep();
    this.onRetry = options.onRetry;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
    this.estimateCostMicros = options.estimateCostMicros;
    this.observe = options.observe;
  }

  /** HTTP attempts this instance has spent, so a canary can print real cost. */
  get attemptsUsed(): number {
    return this.attemptsSpent;
  }

  /**
   * Judge one dimension, with a bounded, observable retry around the call.
   *
   * Fail-closed is unchanged: every attempt must end in a Zod-validated,
   * key-exact, untruncated payload whose dimension matches, and the only way out
   * of this method with a verdict is that check having passed on some attempt.
   * Exhausting the budget rethrows the last failure — retry never becomes "accept
   * anyway", and the parse is identical on every attempt.
   */
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

    const startedAt = this.clock();
    // Scratch state for this call only: a truncation in one call must not raise
    // the completion budget of the next one (the same instance reviews both
    // dimensions of every candidate).
    this.lastFailureWasTruncated = false;
    /** Everything the single observation at the end has to report. */
    const attemptFailures: LexiconReviewErrorCode[] = [];
    let attempts = 0;
    let providerRequestId: string | null = null;
    let stopReason: string | null = null;
    let responseBytes = 0;
    let outcome: LexiconReviewOutcome | null = null;
    let finalError: MiniMaxLexiconReviewError | null = null;
    let observed = false;
    /**
     * Wall-clock time consumed by attempts and backoffs so far, and the clock
     * reading taken right after the last attempt settled.
     *
     * Both the telemetry and the returned decision report this latency, so the two
     * can never disagree, and timing costs exactly one clock read per attempt —
     * the first attempt starts at `startedAt`, so a single-attempt call reads the
     * clock twice in total, exactly as it did before retries existed.
     */
    let elapsedMs = 0;
    let lastSettledAt = startedAt;
    let attemptStartedAt = startedAt;

    /**
     * Emit telemetry exactly once per `review()` call — never per attempt, so a
     * sink cannot be called twice for one verdict. Never throws.
     */
    const emit = (): void => {
      if (observed) return;
      observed = true;
      let estimatedCostMicros: number | null = null;
      try {
        estimatedCostMicros = this.estimateCostMicros
          ? safeCost(this.estimateCostMicros, this.modelVersion, responseBytes)
          : null;
      } catch {
        estimatedCostMicros = null;
      }
      const observation: LexiconReviewObservation = {
        provider: "minimax",
        modelVersion: this.modelVersion,
        dimension,
        providerRequestId,
        latencyMs: elapsedMs,
        estimatedCostMicros,
        failureCode: finalError?.code ?? null,
        stopReason,
        attempts,
        attemptFailures: attemptFailures.slice(),
      };
      try {
        this.observe?.(observation);
      } catch {
        // A telemetry sink must never change a verdict in either direction.
      }
    };

    try {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        // Cancellation is checked before every attempt, so a stop requested during
        // a backoff never causes another call. This is also why `provider-cancelled`
        // is not retryable: retrying it would ignore the caller.
        if (options.signal?.aborted) {
          throw cancelled();
        }

        const response = await this.attemptReview(
          snapshot,
          dimension,
          attempt,
          this.totalTimeoutMs - elapsedMs,
          options.signal,
        );
        // One clock read per attempt: the attempt started at the reading the
        // previous iteration settled on (or at `startedAt` for the first).
        const settledAt = this.clock();
        elapsedMs += Math.max(0, settledAt - attemptStartedAt);
        lastSettledAt = settledAt;
        attempts += 1;
        this.attemptsSpent += 1;
        providerRequestId = response.providerRequestId;
        stopReason = response.stopReason ?? stopReason;
        responseBytes = response.responseBytes;

        if (response.ok) {
          outcome = response.decision.outcome;
          finalError = null;
          emit();
          return {
            dimension,
            outcome,
            // Code-owned identity: never the model's claim, never a human signature.
            reviewerReference: reviewIdentity,
            reviewedAt: new Date(settledAt),
            // Diagnosis, not decision: assembled from the payload's prose. The
            // verdict above came from `decision.outcome` and nothing here can
            // change it — see `composeReviewReason`.
            ...(response.reason === null ? {} : { reason: response.reason }),
            observation: {
              provider: "minimax",
              modelVersion: this.modelVersion,
              dimension,
              providerRequestId,
              latencyMs: elapsedMs,
              estimatedCostMicros: this.estimateCostMicros
                ? safeCost(this.estimateCostMicros, this.modelVersion, responseBytes)
                : null,
              failureCode: null,
              stopReason,
              attempts,
              attemptFailures: attemptFailures.slice(),
            },
          };
        }

        // The failure is recorded on the error itself; it joins `attemptFailures`
        // only if a retry actually follows, so the list holds the *earlier*
        // attempts and its length is exactly `attempts - 1` on a failure.
        finalError = response.error;
        this.lastFailureWasTruncated = response.error.code === "provider-response-truncated";

        const attemptsRemaining = this.maxAttempts - attempt;
        if (attemptsRemaining < 1) break;
        // The retry decision is the error's own flag: one authority, set at the
        // call site that knows whether the request or the answer was at fault.
        if (!response.error.retryable) break;
        if (options.signal?.aborted) break;

        // The backoff and the next attempt both live inside the same wall-clock
        // budget: a wait that would leave nothing to retry with is not a retry.
        const budgetLeftMs = this.totalTimeoutMs - elapsedMs;
        if (budgetLeftMs < minAttemptBudgetMs) break;

        const delayMs = this.backoff(attemptFailures.length + 1);
        const permittedDelayMs = this.onRetry
          ? this.onRetry({
              attempt,
              code: response.error.code,
              delayMs,
              attemptsRemaining,
            })
          : delayMs;
        if (permittedDelayMs === null) break;

        // From here on another call is certain, so this attempt is an "earlier" one.
        attemptFailures.push(response.error.code);

        const waitMs = Math.min(Math.max(0, permittedDelayMs), budgetLeftMs);
        try {
          await this.sleep(waitMs, options.signal);
        } catch {
          // A cancelled wait is over immediately; nothing is left to clean up
          // because the attempt that had a signal already disposed of it.
          break;
        }
        // The wait counts against the wall-clock budget, so the next attempt
        // cannot push the total past `totalTimeoutMs`.
        elapsedMs += waitMs;
        // The next attempt starts once the wait is over. It reuses the last
        // settled reading as its start, so the sleep is not billed as attempt
        // latency — it is carved out of the shared budget above instead.
        attemptStartedAt = lastSettledAt;
      }

      // Budget exhausted, or the failure was not worth another call. Fail closed:
      // the last failure is rethrown and no verdict is ever manufactured.
      if (finalError) throw finalError;
      // Unreachable while maxAttempts >= 1; kept because throwing here would be a
      // silent contract change if the loop above were ever restructured.
      throw new MiniMaxLexiconReviewError(
        "provider-unavailable",
        "Lexicon candidate review produced no verdict.",
        true,
      );
    } finally {
      emit();
    }
  }

  /**
   * One HTTP attempt. Never retries, never decides: it either returns a validated
   * decision or the coded failure the loop above may or may not retry.
   *
   * `remainingMs` is the *remaining* wall-clock budget, not `timeoutMs` again —
   * that is what keeps `maxAttempts` from multiplying the total wait — and it is
   * additionally clamped to `timeoutMs`, which stays the per-attempt ceiling it
   * has always been. It is passed in rather than measured here so this method
   * reads the clock zero times: the loop owns timing, and the loop's clock reads
   * stay countable.
   */
  private async attemptReview(
    snapshot: LexiconReviewSnapshot,
    dimension: CandidateReviewRequest["dimension"],
    attempt: number,
    remainingMs: number,
    parentSignal: AbortSignal | undefined,
  ): Promise<AttemptResult> {
    const requestSignal = createRequestSignal(parentSignal, Math.max(1, Math.min(remainingMs, this.timeoutMs)));
    const isRetry = attempt > 1;
    // A truncated answer gets more room next time; the same budget would truncate
    // the same way. Only truncation raises it, so a normal retry costs the same.
    const budget = isRetry && this.lastFailureWasTruncated ? this.truncatedMaxTokens : this.maxTokens;

    let providerRequestId: string | null = null;
    let stopReason: string | null = null;
    let responseBytes = 0;

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
          max_tokens: budget,
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

      if (!response.ok) {
        return failure(errorForResponseStatus(response.status), providerRequestId, null, 0);
      }

      let envelope: unknown;
      try {
        envelope = await readEnvelope(response);
      } catch {
        return failure(invalidResponse(), providerRequestId, null, 0);
      }

      const parsedResponse = anthropicResponseSchema.safeParse(envelope);
      if (!parsedResponse.success) return failure(invalidResponse(), providerRequestId, null, 0);
      stopReason = parsedResponse.data.stop_reason ?? null;

      const text = parsedResponse.data.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      responseBytes = text.length;
      if (!text) return failure(invalidResponse(), providerRequestId, stopReason, responseBytes);

      // Truncation is checked before the parse: a mid-JSON cut must be reported
      // as "too long", never as "wrong format".
      if (stopReason === "max_tokens") {
        return failure(truncatedResponse(), providerRequestId, stopReason, responseBytes);
      }

      let decision: z.infer<typeof decisionPayloadSchema>;
      try {
        decision = parseDecisionPayload(text);
      } catch (error) {
        if (error instanceof MiniMaxLexiconReviewError) {
          return failure(error, providerRequestId, stopReason, responseBytes);
        }
        return failure(invalidResponse(), providerRequestId, stopReason, responseBytes);
      }

      if (decision.dimension !== dimension) {
        // Another dimension's answer is a wrong answer, and it is worth one more
        // call: the model drifted, the request itself was fine.
        return failure(
          new MiniMaxLexiconReviewError(
            "provider-response-invalid",
            `Lexicon review answered the "${decision.dimension}" dimension when "${dimension}" was requested.`,
            true,
          ),
          providerRequestId,
          stopReason,
          responseBytes,
        );
      }

      return { ok: true, decision, reason: composeReviewReason(decision), providerRequestId, stopReason, responseBytes };
    } catch (error) {
      if (error instanceof MiniMaxLexiconReviewError) {
        return failure(error, providerRequestId, stopReason, responseBytes);
      }
      if (requestSignal.timedOut()) {
        return failure(
          new MiniMaxLexiconReviewError("provider-timeout", "Lexicon candidate review timed out.", true),
          providerRequestId,
          stopReason,
          responseBytes,
        );
      }
      if (requestSignal.signal.aborted) {
        return failure(cancelled(), providerRequestId, stopReason, responseBytes);
      }
      return failure(
        new MiniMaxLexiconReviewError(
          "provider-unavailable",
          "Lexicon candidate review provider is temporarily unavailable.",
          true,
        ),
        providerRequestId,
        stopReason,
        responseBytes,
      );
    } finally {
      requestSignal.dispose();
    }
  }
}

/** Wrap a coded failure in the loop's result shape. */
function failure(
  error: MiniMaxLexiconReviewError,
  providerRequestId: string | null,
  stopReason: string | null,
  responseBytes: number,
): AttemptResult {
  return { ok: false, error, providerRequestId, stopReason, responseBytes };
}

function cancelled(): MiniMaxLexiconReviewError {
  return new MiniMaxLexiconReviewError(
    "provider-cancelled",
    "Lexicon candidate review was cancelled.",
    false,
  );
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

/**
 * Assemble the reviewer's explanation for storage.
 *
 * The vendor returns four prose fields and the seam has room for one string, so
 * this packs them under stable labels:
 *
 * `verdicts: <languageVerdict> | <teachingVerdict>; reason: <reason>; evidence: <…>; issues: <…>`
 *
 * The labels are always present and short, so even a pathologically long answer
 * cannot truncate the *shape* of the record — a reader can always find the
 * reason and see whether evidence was offered. The three long segments are each
 * trimmed (per-item and per-list caps) before assembly, and the whole string is
 * capped last, which means a 1500-character record is a prefix of a real
 * explanation rather than a set of half-sentences.
 *
 * ## Why the prose is packed rather than trusted
 *
 * An earlier design considered keeping the fields separate so a reader could ask
 * "did every rejection have empty evidence?" with one query. That means three
 * more optional jsonb fields, and this string already answers the first question
 * a canary has — *why did `content-es-ES` refuse three quarters of the
 * lexemes?* The labels make the diagnostic greppable (`issues: []` versus
 * `evidence:`) without widening the stored shape further.
 *
 * ## This function cannot influence the verdict
 *
 * It reads prose fields only. It is called *after* the outcome is final, its
 * return value is attached beside the outcome and never fed back into any
 * decision, and a `null` result simply means "no explanation" — which stores the
 * historical four-key shape. A model that writes "outcome: pass" in its reason
 * changes nothing: `decision.outcome` was already read from the payload's
 * `outcome` key, and every later reader (the pipeline, `recordCandidateReview`,
 * the jsonb codec) takes the verdict from that field alone.
 */
function composeReviewReason(decision: z.infer<typeof decisionPayloadSchema>): string | null {
  const evidence = normalizeReviewEvidence(decision.evidence);
  const issues = normalizeReviewIssues(decision.issues);
  const parts = [
    `verdicts: ${decision.languageVerdict} | ${decision.teachingVerdict}`,
    `reason: ${decision.reason}`,
    `evidence: ${evidence === null ? "[]" : evidence.join(" / ")}`,
    `issues: ${issues === null ? "[]" : issues.join(" / ")}`,
  ];
  // The domain cap decides the final length, so the adapter cannot store
  // something a decoder would then have to trim.
  return normalizeReviewReason(parts.join("; "));
}

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
  "Answering content-es-ES: use pass only when the surface form occurs in frozenContext.passage, the part of speech fits the way the form is used there, a lexeme's lemma is its dictionary form for that use, and a phrase is a complete, learner-usable unit of the text provided.",
  "Answering content-es-ES: use fail when any of that is wrong, when the form does not occur in frozenContext.passage, or when the passage is not enough to judge.",
  "How frozenContext is built: passage is contextBefore, then the candidate's surfaceText, then contextAfter, in that order. contextBefore and contextAfter are trimmed slices of the same frozen segment, and one space is restored at each join unless the neighbouring character is punctuation that attaches without one (an opening mark like « or ( attaches to what follows; a comma, a full stop or a closing mark attaches to what precedes). The form is therefore visible in the passage, at the join. Judge usage from the passage (or from the whole frozenContext), never from contextBefore or contextAfter alone.",
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
    '{"outcome":"pass","dimension":"content-es-ES","languageVerdict":"The surface form occurs in the passage and is used as a noun.","teachingVerdict":"The Chinese explanation matches the Spanish meaning.","reason":"The candidate form, part of speech and explanation are all supported by the frozen context.","evidence":["... un terremoto de magnitud 7.2 ..."],"issues":[]}',
  "The exact shape, for dimension teaching-zh-CN, is: " +
    '{"outcome":"fail","dimension":"teaching-zh-CN","languageVerdict":"The Spanish form is used correctly as a noun.","teachingVerdict":"The Chinese explanation omits part of the meaning.","reason":"The explanation is incomplete against the Spanish, so a learner would be misled.","evidence":["meaningZh: 地震"],"issues":["The explanation does not cover the magnitude phrase."]}',
].join(" ");

/**
 * Rebuild the frozen segment around the form.
 *
 * `contextBefore` and `contextAfter` are *trimmed* slices of the segment taken
 * around the form, so the form itself is missing from both and a plain
 * concatenation would run two words together (`un` + `terremoto`). Neither
 * property is guessable by the model, which is what made "the form occurs in the
 * frozen context" unanswerable before: the payload now carries the reassembled
 * passage and the prompt states this rule.
 *
 * The join restores one space, except where the neighbouring character is
 * punctuation that attaches without one:
 *
 * - an opening mark at the end of the left slice (`«`, `(`, `¡`, `“`) attaches to
 *   what follows, so `dice: «` + `hola` stays `dice: «hola`;
 * - a closing mark at the start of the right slice (`,`, `.`, `»`, `)`, `!`, `?`)
 *   attaches to what precedes, so `…adelante",` + `añade` becomes
 *   `…adelante", añade`;
 * - ASCII `"` is both, and is read as an opener only when it directly follows a
 *   space, a colon or a dash.
 *
 * A space that the segment did not have, or a missing one it did, is what this
 * rule exists to prevent: `,` running into `añade` changes the text the model
 * reads, and the form's presence is the one thing this payload must not get
 * wrong.
 */
export function assembleFrozenPassage(
  contextBefore: string,
  surfaceText: string,
  contextAfter: string,
): string {
  return `${contextBefore}${boundarySpace(contextBefore, surfaceText)}${surfaceText}`
    + `${boundarySpace(surfaceText, contextAfter)}${contextAfter}`;
}

/** Punctuation that attaches to the text on its left, so nothing separates them. */
const openingMarkAtEnd = /[\p{Ps}\p{Pi}]$/u;

/**
 * Punctuation that attaches to the text on its right, so nothing separates them.
 *
 * ASCII `"` belongs here even though it is Unicode "other punctuation": when it
 * is the first character after the form, it is closing the quoted span the form
 * sits in, not opening a new one.
 */
const closingMarkAtStart = /^[\p{Pe}\p{Pf},.;:!?…"]/u;

/** The separator one join needs: a space, or nothing when punctuation already joins it. */
function boundarySpace(left: string, right: string): string {
  if (!left || !right) return "";
  if (/\s$/u.test(left) || /^\s/u.test(right)) return "";
  if (closingMarkAtStart.test(right)) return "";
  if (openingMarkAtEnd.test(left)) return "";
  // ASCII `"` is ambiguous: it opens after whitespace, a colon or a dash.
  if (/(?:^|[\s:—–-])"$/u.test(left)) return "";
  return " ";
}

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
      // The form is inside this field, at the join between the two slices, so
      // "does the form occur in the text you were given" has an answer.
      passage: assembleFrozenPassage(snapshot.contextBefore, snapshot.surfaceText, snapshot.contextAfter),
      passageComposition:
        "passage = contextBefore + candidate.surfaceText + contextAfter; both sides are trimmed slices "
        + "of the frozen segment and one space is restored at each join unless the neighbouring character "
        + "is punctuation that attaches without one",
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
    // Not JSON at all: report how long it was, since the usual cause is a
    // truncated or prose-wrapped answer rather than a wrong shape.
    throw invalidResponse({ lengths: { rawText: normalized.length } });
  }
  const parsed = decisionPayloadSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse(describePayload(value));
  return parsed.data;
}

/** Key names and string lengths only — never the text itself. */
function describePayload(value: unknown): Readonly<{
  keys?: readonly string[];
  lengths?: Readonly<Record<string, number>>;
}> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { lengths: { rawType: Array.isArray(value) ? -1 : -2 } };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const lengths: Record<string, number> = {};
  for (const [key, field] of entries) {
    if (typeof field === "string") lengths[key] = field.length;
    else if (Array.isArray(field)) {
      // Report each element's length, so an over-long array member is visible.
      field.forEach((member, index) => {
        if (typeof member === "string") lengths[`${key}[${index}]`] = member.length;
      });
    }
  }
  return { keys: entries.map(([key]) => key), lengths };
}

/**
 * A rejection that says why, without saying what.
 *
 * The bare message used to be "did not match the expected format", which is true
 * and useless: the first real canary run failed on a live candidate with exactly
 * that text and no way to tell a wrong key from an over-long field. This reports
 * the shape of what came back — the key names, and the length of each string
 * field — which is always safe to log, contains none of the vendor's prose, and
 * is enough to distinguish the cases that actually happen: an unexpected key, a
 * missing key, or a field past its length cap.
 */
function invalidResponse(detail?: Readonly<{ keys?: readonly string[]; lengths?: Readonly<Record<string, number>> }>): MiniMaxLexiconReviewError {
  const parts: string[] = [];
  if (detail?.keys?.length) parts.push(`keys=[${detail.keys.join(",")}]`);
  if (detail?.lengths) {
    const lengths = Object.entries(detail.lengths)
      .map(([key, length]) => `${key}=${length}`)
      .join(",");
    if (lengths) parts.push(`lengths={${lengths}}`);
  }
  return new MiniMaxLexiconReviewError(
    "provider-response-invalid",
    `Lexicon review response did not match the expected format.${parts.length ? ` ${parts.join(" ")}` : ""}`,
    // Retryable: this is the model drifting, not the request being wrong. The same
    // frozen candidate usually comes back schema-clean on the next call, and the
    // parse rules are not relaxed to make that happen.
    true,
  );
}

/**
 * The vendor refused the request itself with a 4xx.
 *
 * Same code as a schema mismatch — the wire contract was not what this adapter
 * expected — but explicitly **not** retryable: the same request fails the same
 * way, so a second call only spends quota to learn that again.
 */
function requestRejected(status: number): MiniMaxLexiconReviewError {
  return new MiniMaxLexiconReviewError(
    "provider-response-invalid",
    `Lexicon review request was rejected by the provider (HTTP ${status}).`,
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
    // Explicitly not retryable inside this call. The vendor asked us to slow
    // down; hammering it again from the same call makes that worse, and pausing
    // is the calling pipeline's decision (it owns the run's schedule), not this
    // adapter's. The error still surfaces unchanged either way.
    return new MiniMaxLexiconReviewError("provider-rate-limited", "Lexicon review rate limit was reached.", false);
  }
  if (status >= 500) {
    return new MiniMaxLexiconReviewError("provider-unavailable", "Lexicon review provider is unavailable.", true);
  }
  return requestRejected(status);
}

/**
 * Parse the JSON body of a successful response.
 *
 * Reads a **clone** when it can, leaving the original untouched. A `Response` body
 * can only be consumed once, and a retry loop asks its fetch seam for a body more
 * than once; a seam that hands back the same object (a single stubbed `Response`
 * in a test, a cached upstream response) would otherwise fail every retry with
 * "Body is already read" — which would look like a provider failure and spend the
 * retry on the wrong cause. Cloning keeps repeat reads possible without weakening
 * anything: the clone is parsed by exactly the same code.
 *
 * The fallback matters for the public seam: a caller may inject any
 * `(input, init) => Promise<Response>`, and an exotic implementation can refuse
 * `clone()`. In that case the original is read directly, which is the older
 * behaviour and still correct for a one-shot body.
 */
async function readEnvelope(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return await response.json();
  }
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
 * timeout for the current attempt. Mirrors `createRequestSignal` in the
 * extraction adapter so the two behave identically under abort.
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
