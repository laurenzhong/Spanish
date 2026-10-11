import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxCandidateReviewer,
  assembleFrozenPassage,
  createMiniMaxCandidateReviewer,
  lexiconReviewDimensions,
  lexiconReviewIdentity,
  type MiniMaxCandidateReviewerOptions,
} from "@/src/modules/providers/lexicon-review/server";
import {
  MiniMaxLexiconReviewError,
  type LexiconReviewObservation,
} from "@/src/modules/providers/lexicon-review";
import { fakeLexiconReviewCandidate } from "@/src/modules/providers/lexicon-review";
import { tokenizeSpanish } from "@/src/modules/lexicon-corpus/domain/spanish-token";
import type { CandidateReviewRequest } from "@/src/modules/lexicon-corpus/application/candidate-reviewer";

/**
 * Unit tests for the real MiniMax candidate reviewer.
 *
 * Every test injects a fetch seam: the default vitest path must never call the
 * paid vendor (AGENTS.md §10). The property under test throughout is
 * fail-closed — a truncated, malformed, mismatched, timed-out or cancelled call
 * must produce an error, never a `pass`.
 */

/** Mirrors the adapter's fetch seam so both the URL and the init stay inspectable. */
type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function request(
  dimension: CandidateReviewRequest["dimension"],
  overrides: Partial<CandidateReviewRequest["candidate"]> = {},
): CandidateReviewRequest {
  return { candidate: fakeLexiconReviewCandidate(overrides), dimension };
}

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

function envelope(
  payload: unknown,
  options: Readonly<{ stopReason?: string | null; headers?: Record<string, string>; text?: string }> = {},
) {
  const text = options.text ?? (payload === undefined ? "" : JSON.stringify(payload));
  return new Response(
    JSON.stringify({
      content: [{ type: "text", text }],
      stop_reason: options.stopReason ?? "end_turn",
    }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "mmx-777", ...options.headers } },
  );
}

function reviewerWithResponse(response: Response, extra: Partial<MiniMaxCandidateReviewerOptions> = {}) {
  const fetchImplementation = vi.fn<FetchSeam>(async () => response);
  const reviewer = new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation, clock: () => 1_000, ...extra });
  return { reviewer, fetchImplementation };
}

function reviewerWithFetch(fetchImplementation: FetchSeam, extra: Partial<MiniMaxCandidateReviewerOptions> = {}) {
  return new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation, ...extra });
}

describe("MiniMaxCandidateReviewer", () => {
  it("answers one dimension and writes the AI review identity itself", async () => {
    const { reviewer, fetchImplementation } = reviewerWithResponse(envelope(validPayload()));

    const decision = await reviewer.review(request("content-es-ES"));

    expect(decision.dimension).toBe("content-es-ES");
    expect(decision.outcome).toBe("pass");
    expect(decision.reviewerReference).toBe(lexiconReviewIdentity);
    expect(decision.reviewerReference).toBe("dsh-ai-owner-authorized-review:lexicon-candidate-review");
    expect(decision.reviewedAt).toBeInstanceOf(Date);
    expect(decision.observation).toMatchObject({
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      dimension: "content-es-ES",
      providerRequestId: "mmx-777",
      failureCode: null,
      stopReason: "end_turn",
      estimatedCostMicros: null,
    });

    const init = fetchImplementation.mock.calls[0][1];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(init?.method).toBe("POST");
    expect(body.model).toBe("MiniMax-M3");
    // Generous budget: 900 tokens once truncated a real response mid-JSON.
    expect(body.max_tokens).toBe(4_000);
    expect(body.thinking).toEqual({ type: "disabled" });
    // Never send a credential anywhere but the auth header.
    expect(String(init?.body)).not.toContain("test-key");
  });

  it("does not accept an identity or extra fields from the model", async () => {
    const { reviewer } = reviewerWithResponse(
      envelope({ ...validPayload(), reviewerReference: "human-native-speaker-expert", reviewer: "María" }),
    );
    // An extra key is a schema mismatch: a model answering a different question
    // must not be reinterpreted, and identity is never taken from the response.
    //
    // `retryable: true` because a schema mismatch is model drift, which is worth
    // one more attempt — the parse rules themselves are unchanged, so a stubbed
    // response that never conforms still exhausts the budget and rejects.
    await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: true,
    });
  });

  it("fails closed when the response was truncated mid-JSON", async () => {
    const truncated = '{"outcome":"pass","dimension":"content-es-ES","languageVerdict":"La forma';
    const { reviewer } = reviewerWithResponse(envelope(undefined, { text: truncated, stopReason: "max_tokens" }));

    const failure = reviewer.review(request("content-es-ES"));
    await expect(failure).rejects.toBeInstanceOf(MiniMaxLexiconReviewError);
    await expect(failure).rejects.toMatchObject({ code: "provider-response-truncated", retryable: true });
  });

  it("fails closed when a complete-looking payload arrives with stop_reason max_tokens", async () => {
    // The parse would succeed, so only the stop_reason check can catch it.
    const { reviewer } = reviewerWithResponse(envelope(validPayload(), { stopReason: "max_tokens" }));
    await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-response-truncated",
    });
  });

  it("fails closed on key mismatches: missing key, extra key and renamed key", async () => {
    const missing = validPayload();
    delete (missing as Record<string, unknown>).issues;
    const cases: readonly unknown[] = [
      missing,
      { ...validPayload(), confidence: 0.99 },
      { ...validPayload(), pos: "NOUN", type: "lexeme" },
    ];
    for (const payload of cases) {
      const { reviewer } = reviewerWithResponse(envelope(payload));
      // Still rejects: retrying a stub that never conforms exhausts the budget.
      await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
        code: "provider-response-invalid",
        retryable: true,
      });
    }
  });

  it("fails closed when the verdict names the other dimension", async () => {
    const { reviewer } = reviewerWithResponse(envelope(validPayload({ dimension: "teaching-zh-CN" })));
    await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: true,
    });
  });

  it("fails closed on an outcome outside pass/fail, even when it reads like approval", async () => {
    for (const outcome of ["approved", "PASS", "ok", true]) {
      const { reviewer } = reviewerWithResponse(envelope(validPayload({ outcome })));
      await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
        code: "provider-response-invalid",
      });
    }
  });

  it("records a 'fail' verdict as a fail rather than an error", async () => {
    const { reviewer } = reviewerWithResponse(
      envelope(
        validPayload({
          dimension: "teaching-zh-CN",
          outcome: "fail",
          reason: "La explicación china no cubre el sentido completo.",
        }),
      ),
    );
    const decision = await reviewer.review(request("teaching-zh-CN"));
    expect(decision.outcome).toBe("fail");
    expect(decision.observation.failureCode).toBeNull();
  });

  it("fails closed on a non-JSON body, an empty content array and a non-object payload", async () => {
    const bodies: readonly Response[] = [
      new Response("plain text, not JSON", { status: 200 }),
      new Response(JSON.stringify({ content: [] }), { status: 200 }),
      envelope("[1,2,3]"),
      envelope(undefined, { text: "" }),
      envelope(undefined, { text: "no-json-here" }),
    ];
    for (const response of bodies) {
      const { reviewer } = reviewerWithResponse(response);
      await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
        code: "provider-response-invalid",
      });
    }
  });

  it("accepts a verdict wrapped in a fenced code block", async () => {
    const { reviewer } = reviewerWithResponse(
      envelope(undefined, { text: "```json\n" + JSON.stringify(validPayload()) + "\n```" }),
    );
    const decision = await reviewer.review(request("content-es-ES"));
    expect(decision.outcome).toBe("pass");
  });

  it("maps 401/403/429/5xx to coded errors with the right retryability", async () => {
    const cases: readonly (readonly [number, string, boolean])[] = [
      [401, "provider-auth-failed", false],
      [403, "provider-auth-failed", false],
      // 429 is deliberately NOT retried here. The adapter's backoff is under two
      // seconds, which cannot clear a rate limit, so a repeat would fail the same
      // way and spend quota doing it. Backing off far enough is the calling
      // pipeline's decision, not this adapter's.
      [429, "provider-rate-limited", false],
      [500, "provider-unavailable", true],
      [503, "provider-unavailable", true],
      [400, "provider-response-invalid", false],
    ];
    for (const [status, code, retryable] of cases) {
      const { reviewer } = reviewerWithResponse(new Response("upstream detail", { status }));
      const failure = reviewer.review(request("content-es-ES"));
      await expect(failure).rejects.toMatchObject({ code, retryable });
      await expect(failure).rejects.not.toThrow("upstream detail");
    }
  });

  it("fails closed with provider-auth-failed before spending a call when unconfigured", async () => {
    const fetchImplementation = vi.fn<FetchSeam>();
    const reviewer = new MiniMaxCandidateReviewer({ apiKey: "  ", fetchImplementation });
    await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-auth-failed",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("refuses an unusable frozen candidate before spending a call", async () => {
    const fetchImplementation = vi.fn<FetchSeam>();
    const reviewer = new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation });

    const emptyContext = {
      ...fakeLexiconReviewCandidate().source,
      contextBefore: "",
      contextAfter: "",
    };
    const cases: readonly Partial<CandidateReviewRequest["candidate"]>[] = [
      { surfaceText: "  " },
      { source: emptyContext },
      { source: { ...fakeLexiconReviewCandidate().source, documentStableKey: "" } },
      { source: { ...fakeLexiconReviewCandidate().source, documentVersion: 0 } },
      { source: { ...fakeLexiconReviewCandidate().source, segmentIndex: -1 } },
    ];
    for (const bad of cases) {
      await expect(reviewer.review(request("content-es-ES", bad))).rejects.toMatchObject({
        code: "input-invalid",
        retryable: false,
      });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("reports timeout as retryable and cancellation as not retryable", async () => {
    // A real fetch rejects when its signal aborts; the stub must do the same or
    // the adapter's timeout path would never be exercised.
    const hangingFetch: FetchSeam = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });

    const timedOut = reviewerWithFetch(hangingFetch, { timeoutMs: 5, clock: () => Date.now() });
    await expect(timedOut.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-timeout",
      retryable: true,
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = reviewerWithFetch(hangingFetch);
    await expect(cancelled.review(request("content-es-ES"), { signal: controller.signal })).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
  });

  it("cancels a call already in flight and produces no verdict", async () => {
    const hangingFetch: FetchSeam = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    const reviewer = reviewerWithFetch(hangingFetch);
    const controller = new AbortController();
    const pending = reviewer.review(request("content-es-ES"), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("maps an unexpected fetch rejection to a retryable provider-unavailable", async () => {
    const reviewer = reviewerWithFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: true,
    });
  });

  it("observes provider, model, latency and request id without logging the prompt or the key", async () => {
    const observations: LexiconReviewObservation[] = [];
    const clock = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_042);
    const { reviewer } = reviewerWithResponse(envelope(validPayload()), {
      observe: (observation) => observations.push(observation),
      clock,
    });

    await reviewer.review(request("content-es-ES"));

    expect(observations).toEqual([
      {
        provider: "minimax",
        modelVersion: "MiniMax-M3",
        dimension: "content-es-ES",
        providerRequestId: "mmx-777",
        latencyMs: 42,
        estimatedCostMicros: null,
        failureCode: null,
        stopReason: "end_turn",
        // Retry accounting: a first-attempt success is reported as such, so the
        // canary can show what a run actually cost.
        attempts: 1,
        attemptFailures: [],
      },
    ]);
    const serialized = JSON.stringify(observations);
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain("terremoto");
  });

  it("observes a failure too, and never lets the sink change the outcome", async () => {
    const observations: LexiconReviewObservation[] = [];
    const upstreamFailure = new Response("upstream body", {
      status: 503,
      headers: { "x-request-id": "mmx-777" },
    });
    const throwing = reviewerWithResponse(upstreamFailure, {
      observe: (observation) => {
        observations.push(observation);
        throw new Error("sink exploded");
      },
    });
    await expect(throwing.reviewer.review(request("content-es-ES"))).rejects.toMatchObject({
      code: "provider-unavailable",
    });
    expect(observations[0].failureCode).toBe("provider-unavailable");
    // A 5xx still carries the vendor request id: it is what an operator quotes.
    expect(observations[0].providerRequestId).toBe("mmx-777");
    expect(observations[0].stopReason).toBeNull();

    const ok = reviewerWithResponse(envelope(validPayload()), {
      observe: () => {
        throw new Error("sink exploded");
      },
    });
    await expect(ok.reviewer.review(request("content-es-ES"))).resolves.toMatchObject({ outcome: "pass" });
  });

  it("uses a caller cost estimate and records unknown instead of zero when it fails", async () => {
    const priced = reviewerWithResponse(envelope(validPayload()), {
      estimateCostMicros: () => 1_234.6,
    });
    const decision = await priced.reviewer.review(request("content-es-ES"));
    expect(decision.observation.estimatedCostMicros).toBe(1_235);

    const broken = reviewerWithResponse(envelope(validPayload()), {
      estimateCostMicros: () => {
        throw new Error("no price table");
      },
    });
    const fallback = await broken.reviewer.review(request("content-es-ES"));
    expect(fallback.observation.estimatedCostMicros).toBeNull();
  });

  it("records the vendor request id under any of the header names this host uses", async () => {
    // A real api.minimaxi.com response carries `x-mm-request-id` and `trace-id`
    // and no `x-request-id`, so recording only the latter means recording null
    // on every successful call.
    // The default test header must be cleared for this case: a real response
    // from this host has no `x-request-id` at all.
    const realShape = reviewerWithResponse(
      envelope(validPayload(), {
        headers: { "x-request-id": "", "x-mm-request-id": "mm-abc", "trace-id": "trace-abc" },
      }),
    );
    expect((await realShape.reviewer.review(request("content-es-ES"))).observation.providerRequestId).toBe("mm-abc");

    const traceOnly = reviewerWithResponse(
      envelope(validPayload(), { headers: { "x-request-id": "", "trace-id": "trace-abc" } }),
    );
    expect((await traceOnly.reviewer.review(request("content-es-ES"))).observation.providerRequestId).toBe("trace-abc");

    const canonicalWins = reviewerWithResponse(
      envelope(validPayload(), { headers: { "x-request-id": "canonical", "x-mm-request-id": "mm-abc" } }),
    );
    expect((await canonicalWins.reviewer.review(request("content-es-ES"))).observation.providerRequestId).toBe(
      "canonical",
    );

    const none = reviewerWithResponse(
      envelope(validPayload(), { headers: { "x-request-id": "", "x-mm-request-id": "   " } }),
    );
    expect((await none.reviewer.review(request("content-es-ES"))).observation.providerRequestId).toBeNull();
  });

  it("keeps the two dimensions independent and prompts each one separately", async () => {
    const seen: string[] = [];
    const fetchImplementation = vi.fn<FetchSeam>(async (_url, init) => {
      const body = String(init?.body);
      seen.push(body);
      const asked = JSON.parse(body).messages[0].content[0].text as string;
      return envelope(validPayload({ dimension: asked.includes("teaching-zh-CN") ? "teaching-zh-CN" : "content-es-ES" }));
    });
    const reviewer = new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation });

    const content = await reviewer.review(request("content-es-ES"));
    const teaching = await reviewer.review(request("teaching-zh-CN"));

    expect(seen).toHaveLength(2);
    // The user payload carries the requested dimension, and only that one.
    expect(JSON.parse(JSON.parse(seen[0]).messages[0].content[0].text).dimension).toBe("content-es-ES");
    expect(JSON.parse(JSON.parse(seen[1]).messages[0].content[0].text).dimension).toBe("teaching-zh-CN");
    expect(content.dimension).toBe("content-es-ES");
    expect(teaching.dimension).toBe("teaching-zh-CN");

    // The prompt must name the exact wire keys, or the model guesses them.
    const system = JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body)).system as string;
    for (const key of ["outcome", "dimension", "languageVerdict", "teachingVerdict", "reason", "evidence", "issues"]) {
      expect(system).toContain(key);
    }
  });

  it("loads the key and endpoint from the server environment through its factory", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "https://env.test/anthropic/v1/messages");
    const fetchImplementation = vi.fn<FetchSeam>(async () => envelope(validPayload()));
    const reviewer = createMiniMaxCandidateReviewer({ fetchImplementation });

    await reviewer.review(request("content-es-ES"));

    expect(fetchImplementation.mock.calls[0][0]).toBe("https://env.test/anthropic/v1/messages");
    expect((fetchImplementation.mock.calls[0][1]?.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
    vi.unstubAllEnvs();
  });

  it("defaults to the api.minimaxi.com host when the environment does not set one", async () => {
    const previous = process.env.MINIMAX_API_ENDPOINT;
    delete process.env.MINIMAX_API_ENDPOINT;
    try {
      const fetchImplementation = vi.fn<FetchSeam>(async () => envelope(validPayload()));
      const reviewer = createMiniMaxCandidateReviewer({ apiKey: "k", fetchImplementation });
      await reviewer.review(request("content-es-ES"));
      // The same key returns 401 from api.minimax.io, so the host is not cosmetic.
      expect(fetchImplementation.mock.calls[0][0]).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    } finally {
      if (previous !== undefined) process.env.MINIMAX_API_ENDPOINT = previous;
    }
  });

  it("answers the teaching dimension with its own payload shape", async () => {
    const { reviewer } = reviewerWithResponse(
      envelope(
        validPayload({
          dimension: "teaching-zh-CN",
          languageVerdict: "La forma española se usa correctamente como sustantivo.",
          teachingVerdict: "La explicación china corresponde al sentido español.",
          outcome: "pass",
        }),
      ),
    );

    const decision = await reviewer.review(request("teaching-zh-CN"));

    expect(decision.dimension).toBe("teaching-zh-CN");
    expect(decision.outcome).toBe("pass");
  });

  it("exposes the two dimension values the seam defines", () => {
    expect(lexiconReviewDimensions).toEqual(["content-es-ES", "teaching-zh-CN"]);
  });
});

/**
 * The satisfiability of the presence instruction.
 *
 * `contextBefore` and `contextAfter` are trimmed slices taken *around* the form,
 * so by construction they do not contain it. The prompt used to ask the reviewer
 * to pass only when "the surface form occurs in the frozen context" while the
 * payload sent exactly those two slices — an instruction the model could not
 * satisfy, which read as mass rejection once combined with "when in doubt,
 * answer fail".
 *
 * These cases fail if either half of the fix is reverted: dropping `passage`
 * from the payload, or restoring the wording that points the check at text the
 * form is not in.
 */
describe("reviewer payload satisfiability", () => {
  /** The two halves of the request body, parsed. */
  async function sentRequest(dimension: CandidateReviewRequest["dimension"] = "content-es-ES") {
    const { reviewer, fetchImplementation } = reviewerWithResponse(envelope(validPayload({ dimension })));
    await reviewer.review(request(dimension));
    const body = JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body)) as {
      system: string;
      messages: readonly { content: readonly { text: string }[] }[];
    };
    const payload = JSON.parse(body.messages[0]!.content[0]!.text) as {
      frozenContext: Readonly<{
        contextBefore: string;
        contextAfter: string;
        passage: string;
        passageComposition: string;
      }>;
    };
    return { system: body.system, frozenContext: payload.frozenContext };
  }

  it("sends the form itself, inside the reassembled passage", async () => {
    const { frozenContext } = await sentRequest();

    expect(frozenContext.passage).toBe(
      "Y en Panamá, un terremoto de magnitud 7.2 sacudió el sureste del país.",
    );
    // The decisive property: the form is a real token *of what was sent*.
    expect(tokenizeSpanish(frozenContext.passage).map((token) => token.normalized)).toContain("terremoto");
    // The slices still travel, and they still exclude the form — which is
    // exactly why the passage has to exist.
    expect(frozenContext.contextBefore).toBe("Y en Panamá, un");
    expect(frozenContext.contextAfter).toBe("de magnitud 7.2 sacudió el sureste del país.");
    expect(frozenContext.contextBefore).not.toContain("terremoto");
    expect(frozenContext.contextAfter).not.toContain("terremoto");
  });

  it("states the three-field relationship in the payload and in the prompt", async () => {
    const { system, frozenContext } = await sentRequest();

    for (const field of ["contextBefore", "surfaceText", "contextAfter"]) {
      expect(frozenContext.passageComposition, `payload must name ${field}`).toContain(field);
    }
    for (const field of ["contextBefore", "surfaceText", "contextAfter"]) {
      expect(system, `prompt must name ${field}`).toContain(field);
    }
    expect(system).toContain("frozenContext.passage");
  });

  it("never asks the reviewer to judge a form it cannot see", async () => {
    const { system, frozenContext } = await sentRequest();

    // Revert detector: without `passage` there is nothing in the request that
    // contains the form, and the presence question is unanswerable again.
    expect(typeof frozenContext.passage).toBe("string");
    expect(frozenContext.passage).not.toBe("");

    // Revert detector for the wording: the check must point at the passage, not
    // at "the frozen context" (which is the two slices).
    expect(system).toContain("occurs in frozenContext.passage");
    expect(system).toContain("does not occur in frozenContext.passage");
    expect(system).not.toMatch(/occurs in the frozen context\b/);
    expect(system).not.toMatch(/the form is not in the context\b/);
  });

  it("keeps the teaching dimension on the same passage", async () => {
    const { frozenContext } = await sentRequest("teaching-zh-CN");
    // The Chinese gloss is judged against the Spanish; that Spanish must include
    // the form, or the same defect returns one dimension over.
    expect(tokenizeSpanish(frozenContext.passage).map((token) => token.normalized)).toContain("terremoto");
  });

  it("rebuilds the passage without running words together", () => {
    // The slices are trimmed, so a naive concatenation would produce
    // "unterremoto"; the join is what restores the segment's spacing.
    expect(assembleFrozenPassage("Y en Panamá, un", "terremoto", "de magnitud 7.2")).toBe(
      "Y en Panamá, un terremoto de magnitud 7.2",
    );
    // Punctuation keeps the spacing the segment had: no space after an opening
    // mark, none before a closing one.
    expect(assembleFrozenPassage("dice: «", "hola", "».")).toBe("dice: «hola».");
    expect(assembleFrozenPassage("", "casa", " y tu casa")).toBe("casa y tu casa");
    expect(assembleFrozenPassage("Mi", "casa", "")).toBe("Mi casa");
  });
});
