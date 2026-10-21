import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxCandidateReviewer } from "@/src/modules/providers/lexicon-review/server";

/**
 * A rejected review payload must say why it was rejected.
 *
 * The first real canary run failed with "did not match the expected format" and
 * nothing else, which is true and useless: a wrong key, a missing key and an
 * over-long field all produce that same sentence. The adapter now reports the
 * key names and each string field's length, which is what distinguishes them —
 * and it reports only those, never the vendor's prose.
 */

type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function reviewerReturning(payload: unknown): MiniMaxCandidateReviewer {
  const fetchImplementation: FetchSeam = async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload) }],
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "x-mm-request-id": "mmx-diag" } },
    );
  return new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation });
}

const request = {
  candidate: {
    id: "lexeme|article|diag.a|1|0|terremoto",
    kind: "lexeme",
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    status: "discovered",
    revision: 1,
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: new Date("2026-10-11T00:00:00.000Z"),
    updatedAt: new Date("2026-10-11T00:00:00.000Z"),
    source: {
      documentKind: "article",
      documentStableKey: "diag.a",
      documentVersion: 1,
      segmentIndex: 0,
      contextBefore: "un",
      contextAfter: "de magnitud",
      sourceTitle: "t",
      sourceKind: "article-rss",
    },
  },
  dimension: "content-es-ES",
} as never;

async function messageFrom(payload: unknown): Promise<string> {
  const outcome = await reviewerReturning(payload)
    .review(request)
    .then(
      () => null,
      (error: { message?: string }) => error.message ?? "",
    );
  return outcome ?? "";
}

describe("a rejected review payload reports enough to diagnose it", () => {
  it("names an unexpected key", async () => {
    const message = await messageFrom({
      outcome: "pass",
      dimension: "content-es-ES",
      languageVerdict: "ok",
      teachingVerdict: "ok",
      reason: "fine",
      evidence: ["context"],
      issues: [],
      // The exact drift that a strict schema exists to catch.
      confidence: 0.9,
    });
    expect(message).toContain("keys=[");
    expect(message).toContain("confidence");
  });

  it("reports the length of an over-long field rather than just refusing", async () => {
    const message = await messageFrom({
      outcome: "pass",
      dimension: "content-es-ES",
      languageVerdict: "x".repeat(500),
      teachingVerdict: "ok",
      reason: "fine",
      evidence: ["context"],
      issues: [],
    });
    expect(message).toMatch(/languageVerdict=500/);
  });

  it("reports the length of an over-long array member", async () => {
    const message = await messageFrom({
      outcome: "pass",
      dimension: "content-es-ES",
      languageVerdict: "ok",
      teachingVerdict: "ok",
      reason: "fine",
      evidence: ["y".repeat(450)],
      issues: [],
    });
    expect(message).toMatch(/evidence\[0\]=450/);
  });

  it("reports the raw length when the answer is not JSON at all", async () => {
    const message = await messageFrom("I am afraid I cannot help with that request.");
    expect(message).toMatch(/rawText=\d+/);
  });

  it("never leaks the vendor's prose", async () => {
    const secret = "SENTINEL_PROSE_SHOULD_NOT_APPEAR";
    const message = await messageFrom({
      outcome: "pass",
      dimension: "content-es-ES",
      languageVerdict: `${secret}${"x".repeat(500)}`,
      teachingVerdict: "ok",
      reason: "fine",
      evidence: ["context"],
      issues: [],
    });
    expect(message).not.toContain(secret);
    // The length is still reported, so the diagnosis survives.
    expect(message).toMatch(/languageVerdict=\d+/);
  });
});
