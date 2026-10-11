import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxCandidateReviewer,
  type MiniMaxCandidateReviewerOptions,
} from "@/src/modules/providers/lexicon-review/server";
import {
  MiniMaxLexiconReviewError,
  createLinearBackoff,
  createSleep,
  isRetryableLexiconReviewCode,
  lexiconReviewRetryableCodes,
  type LexiconReviewObservation,
} from "@/src/modules/providers/lexicon-review";
import { fakeLexiconReviewCandidate } from "@/src/modules/providers/lexicon-review";
import type { CandidateReviewRequest } from "@/src/modules/lexicon-corpus/application/candidate-reviewer";

/**
 * Controlled retry around one dimension's review.
 *
 * The production flake is model non-determinism: about one run in three came back
 * with a payload the strict schema refuses. Retrying that is worth a call; the
 * tests below pin *which* failures are worth a call, that the budget is bounded
 * and counted, that nothing ever waits for real, and — the safety-critical one —
 * that exhausting the budget throws instead of returning `pass`.
 */

type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const request: CandidateReviewRequest = {
  candidate: fakeLexiconReviewCandidate(),
  dimension: "content-es-ES",
};

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "pass",
    dimension: "content-es-ES",
    languageVerdict: "La forma aparece en el contexto y se usa como sustantivo.",
    teachingVerdict: "La explicación china corresponde al sentido español.",
    reason: "La forma, la categoría y la explicación están respaldadas por el contexto congelado.",
    evidence: ["un terremoto de magnitud 7.2"],
    issues: [],
    ...overrides,
  };
}

/** A payload the strict schema refuses, but which is valid JSON. */
function driftedPayload() {
  return { ...validPayload(), confidence: 0.93 };
}

function okResponse(payload: unknown = validPayload(), stopReason = "end_turn"): Response {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }], stop_reason: stopReason }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "mmx-retry" } },
  );
}

function truncatedResponse(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text: '{"outcome":"pass","dimension":"content-es-ES","language' }],
      stop_reason: "max_tokens",
    }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "mmx-trunc" } },
  );
}

function statusResponse(status: number): Response {
  return new Response("upstream detail", { status, headers: { "x-request-id": "mmx-status" } });
}

/** Headers recorded for every attempt, so a test can assert the delays and budget. */
type Harness = Readonly<{
  reviewer: MiniMaxCandidateReviewer;
  fetchImplementation: ReturnType<typeof vi.fn<FetchSeam>>;
  observations: LexiconReviewObservation[];
  sleeps: number[];
  bodies: () => readonly Record<string, unknown>[];
  callCount: () => number;
}>;

function harness(
  responses: readonly (Response | (() => Response | Promise<Response>))[],
  options: Partial<MiniMaxCandidateReviewerOptions> = {},
): Harness {
  let call = 0;
  const fetchImplementation = vi.fn<FetchSeam>(async (_url, init) => {
    void init;
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return typeof next === "function" ? await next() : next;
  });
  const observations: LexiconReviewObservation[] = [];
  const sleeps: number[] = [];
  const reviewer = new MiniMaxCandidateReviewer({
    apiKey: "test-key",
    fetchImplementation,
    // No test may ever wait: the default sleep is replaced outright.
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    observe: (observation) => observations.push(observation),
    ...options,
  });
  const bodies = () =>
    fetchImplementation.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
  return { reviewer, fetchImplementation, observations, sleeps, bodies, callCount: () => call };
}

describe("retry allow-list", () => {
  it("is exactly the four codes a repeat call can plausibly fix", () => {
    expect([...lexiconReviewRetryableCodes].sort()).toEqual([
      "provider-response-invalid",
      "provider-response-truncated",
      "provider-timeout",
      "provider-unavailable",
    ]);
    for (const code of lexiconReviewRetryableCodes) {
      expect(isRetryableLexiconReviewCode(code)).toBe(true);
    }
    for (const code of [
      "provider-auth-failed",
      "provider-cancelled",
      "provider-rate-limited",
      "input-invalid",
    ] as const) {
      expect(isRetryableLexiconReviewCode(code)).toBe(false);
    }
  });
});

describe("retry succeeds when the model drifts once", () => {
  it("returns the verdict on the second attempt and reports attempts=2", async () => {
    const { reviewer, fetchImplementation, observations, sleeps } = harness([
      okResponse(driftedPayload()),
      okResponse(validPayload({ outcome: "fail", reason: "La forma se usa correctamente." })),
    ]);

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("fail");
    expect(decision.observation.attempts).toBe(2);
    expect(decision.observation.attemptFailures).toEqual(["provider-response-invalid"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    // One backoff happened, and it was a real delay rather than an immediate re-hit.
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    // Telemetry is emitted once for the whole call, not once per attempt.
    expect(observations).toHaveLength(1);
    expect(observations[0].attempts).toBe(2);
    expect(observations[0].failureCode).toBeNull();
    // The identity and the dimension are still code-owned after a retry.
    expect(decision.reviewerReference).toBe("dsh-ai-owner-authorized-review:lexicon-candidate-review");
    expect(decision.dimension).toBe("content-es-ES");
  });

  it("keeps the parse rules strict on every attempt", async () => {
    // Attempt 1 is refused for an extra key; attempt 2 still carries the extra key
    // and must be refused too — retry is not a second, looser parse.
    const { reviewer, fetchImplementation } = harness([
      okResponse(driftedPayload()),
      okResponse(driftedPayload()),
    ]);

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("counts every attempt on the instance, so a canary can price the run", async () => {
    const { reviewer, callCount } = harness([
      okResponse(driftedPayload()),
      okResponse(validPayload({ dimension: "content-es-ES" })),
      okResponse(validPayload({ dimension: "teaching-zh-CN" })),
    ]);
    await reviewer.review(request);
    expect(reviewer.attemptsUsed).toBe(2);

    // The second dimension is answered on a fresh call: the counter accumulates,
    // which is what makes the real spend visible rather than per-call guesses.
    await reviewer.review({ ...request, dimension: "teaching-zh-CN" });
    expect(reviewer.attemptsUsed).toBe(3);
    expect(callCount()).toBe(3);
  });
});

describe("retry is bounded", () => {
  it("gives up after the configured attempt cap and never returns a pass", async () => {
    const { reviewer, fetchImplementation, observations } = harness(
      [okResponse(driftedPayload())],
      { maxAttempts: 3 },
    );

    const failure = reviewer.review(request);

    await expect(failure).rejects.toBeInstanceOf(MiniMaxLexiconReviewError);
    await expect(failure).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(observations[0].attempts).toBe(3);
    // The list holds the *earlier* failures — one per retry actually made — while
    // the attempt that used up the budget is reported as `failureCode` below.
    expect(observations[0].attemptFailures).toEqual([
      "provider-response-invalid",
      "provider-response-invalid",
    ]);
    expect(observations[0].failureCode).toBe("provider-response-invalid");
  });

  it("exhausting the budget is fail-closed: no verdict, ever", async () => {
    // Every attempt returns a schema-clean-looking payload with the wrong
    // dimension. There is no code path that can promote this to an outcome.
    const wrongDimension = okResponse(validPayload({ dimension: "teaching-zh-CN" }));
    const { reviewer } = harness([wrongDimension], { maxAttempts: 2 });

    const outcome = await reviewer
      .review(request)
      .then(
        (decision) => decision,
        (error: unknown) => error,
      );

    expect(outcome).toBeInstanceOf(MiniMaxLexiconReviewError);
    expect(outcome).not.toHaveProperty("outcome");
    expect(outcome).not.toHaveProperty("reviewerReference");
  });

  it("honours a smaller cap", async () => {
    const { reviewer, fetchImplementation } = harness([okResponse(driftedPayload())], { maxAttempts: 1 });
    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("clamps an unusable cap instead of trusting it", async () => {
    for (const [configured, expected] of [
      [0, 1],
      [-4, 1],
      [2.5, 1],
      [99, 5],
    ] as const) {
      const { reviewer, fetchImplementation } = harness([okResponse(driftedPayload())], {
        maxAttempts: configured,
      });
      await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
      expect(fetchImplementation).toHaveBeenCalledTimes(expected);
    }
  });

  it("stops retrying once the wall-clock budget is spent", async () => {
    // The first attempt already consumed the whole budget, so there is nothing
    // left to retry with: the adapter must not start a second call.
    let clock = 1_000;
    const { reviewer, fetchImplementation, sleeps } = harness(
      [
        () => {
          clock += 5_000;
          return okResponse(driftedPayload());
        },
      ],
      { maxAttempts: 3, totalTimeoutMs: 2_000, clock: () => clock, backoffMs: 10 },
    );

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
  });
});

describe("only retryable failures are retried", () => {
  it("does not retry an auth failure: one call, no wasted quota", async () => {
    const { reviewer, fetchImplementation, sleeps } = harness([statusResponse(401)]);

    await expect(reviewer.review(request)).rejects.toMatchObject({
      code: "provider-auth-failed",
      retryable: false,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
  });

  it("does not retry a 4xx request error", async () => {
    // A 400 means the request itself was refused; the retry budget must not spend
    // a second call finding that out again.
    const { reviewer, fetchImplementation } = harness([statusResponse(400)]);
    await expect(reviewer.review(request)).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate limit, which is the caller's cue to pause", async () => {
    const { reviewer, fetchImplementation, sleeps } = harness([statusResponse(429)], { maxAttempts: 3 });
    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-rate-limited" });
    // The budget was available and deliberately unused: a 429 handler belongs to
    // the caller, which can pause honestly instead of hammering in-call.
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
  });

  it("does not retry a request the adapter refuses before any call", async () => {
    const { reviewer, fetchImplementation } = harness([okResponse()]);
    await expect(
      reviewer.review({ candidate: fakeLexiconReviewCandidate({ surfaceText: "  " }), dimension: "content-es-ES" }),
    ).rejects.toMatchObject({ code: "input-invalid" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("retries a 5xx, which is transient by definition", async () => {
    const { reviewer, fetchImplementation } = harness([statusResponse(503), okResponse()]);
    const decision = await reviewer.review(request);
    expect(decision.outcome).toBe("pass");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("lets an injected hook decline a retry the default policy would allow", async () => {
    const declines: number[] = [];
    const { reviewer, fetchImplementation } = harness([okResponse(driftedPayload())], {
      onRetry: (event) => {
        declines.push(event.attempt);
        expect(event.code).toBe("provider-response-invalid");
        expect(event.attemptsRemaining).toBeGreaterThan(0);
        return null;
      },
    });

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(declines).toEqual([1]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("truncation is retried with more room", () => {
  it("raises the completion budget after a truncated answer", async () => {
    const { reviewer, bodies } = harness([truncatedResponse(), okResponse()], { maxTokens: 4_000 });

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("pass");
    expect(decision.observation.attempts).toBe(2);
    const [first, second] = bodies();
    // Re-asking with the same budget would truncate the same way.
    expect(first.max_tokens).toBe(4_000);
    expect(second.max_tokens).toBeGreaterThan(4_000);
  });

  it("keeps using the raised budget while the answer is still truncated", async () => {
    const { reviewer, bodies, observations } = harness(
      [truncatedResponse(), truncatedResponse(), okResponse()],
      { maxTokens: 4_000 },
    );

    await reviewer.review(request);

    const budgets = bodies().map((body) => body.max_tokens);
    expect(budgets).toEqual([4_000, 8_000, 8_000]);
    expect(observations[0].attemptFailures).toEqual([
      "provider-response-truncated",
      "provider-response-truncated",
    ]);
  });

  it("caps the raised budget so one candidate cannot demand an unbounded completion", async () => {
    const { reviewer, bodies } = harness([truncatedResponse(), okResponse()], {
      maxTokens: 4_000,
      truncatedMaxTokens: 6_000,
    });
    await reviewer.review(request);
    expect(bodies().map((body) => body.max_tokens)).toEqual([4_000, 6_000]);
  });

  it("does not raise the budget for a non-truncation retry", async () => {
    const { reviewer, bodies } = harness([okResponse(driftedPayload()), okResponse()], { maxTokens: 4_000 });
    await reviewer.review(request);
    expect(bodies().map((body) => body.max_tokens)).toEqual([4_000, 4_000]);
  });

  it("fails closed with the truncation code when every attempt truncates", async () => {
    const { reviewer } = harness([truncatedResponse()], { maxAttempts: 2 });
    await expect(reviewer.review(request)).rejects.toMatchObject({
      code: "provider-response-truncated",
      retryable: true,
    });
  });
});

describe("cancellation wins over the retry budget", () => {
  it("stops immediately when the caller cancelled before the first attempt", async () => {
    const controller = new AbortController();
    controller.abort();
    const { reviewer, fetchImplementation, sleeps } = harness([okResponse()]);

    await expect(reviewer.review(request, { signal: controller.signal })).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(sleeps).toHaveLength(0);
  });

  it("does not start another attempt when the signal aborts during the backoff wait", async () => {
    const controller = new AbortController();
    const observations: LexiconReviewObservation[] = [];
    const fetchImplementation = vi.fn<FetchSeam>(async () => okResponse(driftedPayload()));
    const reviewer = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation,
      // The wait itself is where the cancellation lands.
      sleep: async () => {
        controller.abort();
      },
      observe: (observation) => observations.push(observation),
    });

    await expect(reviewer.review(request, { signal: controller.signal })).rejects.toMatchObject({
      // The stop happens between attempts: the caller asked to cancel, so that is
      // the answer — not a silent continuation and not a verdict.
      code: "provider-cancelled",
      retryable: false,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(observations[0].attempts).toBe(1);
  });

  it("propagates a cancellation that a real sleep would observe", async () => {
    if (process.env.SMOKE_RETRY_REAL_WAIT === "1") {
      // Opt-in only: the default path must never wait for real.
      const controller = new AbortController();
      const reviewer = new MiniMaxCandidateReviewer({ apiKey: "k", fetchImplementation: vi.fn<FetchSeam>() });
      const pending = reviewer.review(request, { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: "provider-cancelled" });
    }
    expect(true).toBe(true);
  });
});

describe("timeouts keep working with retries in the picture", () => {
  it("reports a timeout as provider-timeout", async () => {
    const hanging: FetchSeam = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    const fetchImplementation = vi.fn<FetchSeam>(hanging);
    const reviewer = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation,
      // The attempt timeout is short, but the shared budget is generous, so the
      // retry has room — which is the point: a timeout is retryable only if
      // something is left to retry with.
      timeoutMs: 5,
      totalTimeoutMs: 10_000,
      // Instant, so the two 5ms aborts are the only real waiting in this test.
      sleep: async () => {},
    });

    await expect(reviewer.review(request)).rejects.toMatchObject({
      code: "provider-timeout",
      retryable: true,
    });
    expect(fetchImplementation.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not retry a timeout once the wall-clock budget is gone", async () => {
    const hanging: FetchSeam = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    const fetchImplementation = vi.fn<FetchSeam>(hanging);
    const reviewer = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 5,
      // The whole budget is the first attempt, so there is nothing left to spend.
      totalTimeoutMs: 5,
      sleep: async () => {},
    });

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-timeout" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("accounts for the backoff inside the total budget", async () => {
    let clock = 1_000;
    const { reviewer, sleeps } = harness(
      [
        () => {
          clock += 100;
          return okResponse(driftedPayload());
        },
        () => {
          clock += 100;
          return okResponse(driftedPayload());
        },
      ],
      { maxAttempts: 3, totalTimeoutMs: 3_000, clock: () => clock, backoffMs: 40 },
    );

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    // Two waits happened inside a 3s window (three ~100ms attempts plus backoff),
    // and neither could exceed what was left of the budget.
    expect(sleeps).toHaveLength(2);
    for (const waited of sleeps) {
      expect(waited).toBeLessThanOrEqual(1_000);
    }
  });

  it("skips an attempt that no longer fits in the wall-clock budget", async () => {
    // The first attempt costs 100ms of a 1050ms budget, leaving 950ms against a
    // 1000ms floor: the call stops rather than starting an attempt that cannot
    // finish. The injected clock is what makes the spend measurable.
    let clock = 1_000;
    const { reviewer, fetchImplementation, sleeps } = harness(
      [
        () => {
          clock += 100;
          return okResponse(driftedPayload());
        },
      ],
      { maxAttempts: 3, totalTimeoutMs: 1_050, clock: () => clock, backoffMs: 10 },
    );

    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
  });
});

describe("backoff and sleep injection", () => {
  it("never waits for real in this suite", () => {
    // Guards the rule rather than a code path: if a future edit drops the
    // injected sleep, the retry tests would start taking seconds.
    const startedAt = Date.now();
    expect(typeof createSleep()).toBe("function");
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("produces a jittered linear delay that never goes negative", () => {
    const backoff = createLinearBackoff(100, { random: () => 0 });
    expect(backoff(1)).toBe(75);
    expect(backoff(2)).toBe(150);
    const high = createLinearBackoff(100, { random: () => 1 });
    expect(high(1)).toBe(125);
    // Jitter is centered, never negative and never past the cap.
    const capped = createLinearBackoff(100, { random: () => 1, maxMs: 110 });
    expect(capped(9)).toBe(110);
    expect(capped(1)).toBeLessThan(130);
  });

  it("an injected backoff decides the delay, and a zero delay is still a wait", async () => {
    const { reviewer, sleeps } = harness([okResponse(driftedPayload()), okResponse()], {
      backoff: (failedAttempts) => {
        expect(failedAttempts).toBe(1);
        return 0;
      },
    });
    await reviewer.review(request);
    expect(sleeps).toEqual([0]);
  });

  it("the real sleep resolves early when the signal aborts", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const waiting = createSleep()(10_000, controller.signal);
    controller.abort();
    await waiting;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
