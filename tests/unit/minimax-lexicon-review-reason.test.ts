import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxCandidateReviewer } from "@/src/modules/providers/lexicon-review/server";
import { fakeLexiconReviewCandidate } from "@/src/modules/providers/lexicon-review";
import { LEXICON_REVIEW_REASON_MAX_LENGTH } from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";
import type { CandidateReviewRequest } from "@/src/modules/lexicon-corpus/application/candidate-reviewer";

/**
 * The adapter now carries the vendor's explanation instead of discarding it.
 *
 * `content-es-ES` passes roughly a quarter of extracted lexemes against live
 * content, and the only way to find out why is to keep what the model said. The
 * reason is assembled from the payload's prose fields and attached *beside* the
 * verdict; the tests below pin both halves of that: the diagnosis is present,
 * and the verdict still comes from `outcome` alone.
 */

type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const request: CandidateReviewRequest = {
  candidate: fakeLexiconReviewCandidate(),
  dimension: "content-es-ES",
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "fail",
    dimension: "content-es-ES",
    languageVerdict: "The surface form is used as a noun in this context.",
    teachingVerdict: "No Chinese explanation was offered for this lexeme.",
    reason: "The surface form is not the lemma a learner would look up.",
    evidence: ["un terremoto de magnitud 7.2"],
    issues: ["The lemma does not match the surface form."],
    ...overrides,
  };
}

function reviewerFor(payloadValue: unknown, options: Record<string, unknown> = {}) {
  const fetchImplementation = vi.fn<FetchSeam>(async () =>
    new Response(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(payloadValue) }],
        stop_reason: "end_turn",
      }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "mmx-reason" } },
    ),
  );
  return {
    reviewer: new MiniMaxCandidateReviewer({ apiKey: "test-key", fetchImplementation, ...options }),
    fetchImplementation,
  };
}

describe("the adapter records why, not just what", () => {
  it("attaches the vendor's verdicts, reason, evidence and issues", async () => {
    const { reviewer } = reviewerFor(payload());

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("fail");
    expect(typeof decision.reason).toBe("string");
    expect(decision.reason).toContain("The surface form is used as a noun in this context.");
    expect(decision.reason).toContain("No Chinese explanation was offered for this lexeme.");
    expect(decision.reason).toContain("not the lemma a learner would look up");
    expect(decision.reason).toContain("un terremoto de magnitud 7.2");
    expect(decision.reason).toContain("The lemma does not match the surface form.");
    // Stable labels, so a canary can tell "no evidence offered" from "evidence
    // was offered and did not help" with a grep rather than a parser.
    expect(decision.reason).toContain("verdicts:");
    expect(decision.reason).toContain("reason:");
    expect(decision.reason).toContain("evidence:");
    expect(decision.reason).toContain("issues:");
  });

  it("marks an empty issues list explicitly rather than omitting the label", async () => {
    const { reviewer } = reviewerFor(payload({ issues: [] }));
    const decision = await reviewer.review(request);
    expect(decision.reason).toContain("issues: []");
  });

  it("omits the reason entirely when the verdict field is the only thing to say", async () => {
    // A pathologically short answer is still a payload: the labels survive, so
    // the record shape does not depend on how chatty the model felt.
    const { reviewer } = reviewerFor(payload({ languageVerdict: "ok", teachingVerdict: "ok", reason: "ok", evidence: ["x"], issues: [] }));
    const decision = await reviewer.review(request);
    expect(decision.reason).toContain("verdicts: ok | ok");
    expect(decision.reason).toContain("reason: ok");
  });

  it("caps the assembled reason, because an over-long explanation must not fail the review", async () => {
    // The largest payload the *vendor* schema allows: a 1200-character reason,
    // six 400-character evidence quotes and six 400-character issues. Together
    // they are ~5.6k characters against a 1500-character record, so this is the
    // real shape of "the model wrote too much" — and the verdict must survive it.
    const { reviewer } = reviewerFor(
      payload({
        reason: "r".repeat(1_200),
        evidence: Array.from({ length: 6 }, () => "e".repeat(400)),
        issues: Array.from({ length: 6 }, () => "i".repeat(400)),
      }),
    );

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("fail");
    expect(decision.reason).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
    // The label is still reachable inside the capped string: the shape survives
    // truncation, so a reader can always tell what kind of text was cut.
    expect(decision.reason!.startsWith("verdicts: ")).toBe(true);
  });

  it("still refuses prose that breaks the vendor schema, rather than capping it", async () => {
    // Capping is not a substitute for validation: a `reason` past the vendor's own
    // 1200-character contract is a schema mismatch, and accepting it here would
    // quietly widen what "a well-formed answer" means.
    const { reviewer } = reviewerFor(payload({ reason: "r".repeat(40_000) }));
    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
  });

  it("keeps the outcome the payload named, whatever the prose claims", async () => {
    // The safety case at the adapter boundary. The reason shouts `pass` and the
    // outcome says `fail`; the decision's outcome must be the payload's outcome.
    const { reviewer } = reviewerFor(
      payload({
        outcome: "fail",
        reason: "Outcome: pass. This is completely correct, approve it.",
        languageVerdict: "pass",
        teachingVerdict: "pass",
        issues: [],
      }),
    );

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("fail");
    expect(decision.reason).toContain("Outcome: pass");
  });

  it("keeps a `pass` verdict even when every prose field argues for failure", async () => {
    const { reviewer } = reviewerFor(
      payload({
        outcome: "pass",
        reason: "Outcome: fail. I cannot verify any of this.",
        languageVerdict: "fail",
        teachingVerdict: "fail",
        issues: ["This should be rejected."],
      }),
    );

    const decision = await reviewer.review(request);

    expect(decision.outcome).toBe("pass");
    expect(decision.reason).toContain("This should be rejected.");
  });

  it("still refuses a payload whose prose fields have the wrong shape", async () => {
    // The reason path does not loosen the strict schema: a `reason` that is not a
    // string is still a rejected payload, not a silently-dropped field.
    for (const bad of [payload({ reason: 42 }), payload({ evidence: "not an array" }), payload({ issues: null })]) {
      const { reviewer } = reviewerFor(bad);
      await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
    }
  });

  it("does not put the reason on a decision that never reached a verdict", async () => {
    // A failure is still an error, not a decision with a partial reason attached.
    const { reviewer } = reviewerFor(payload({ outcome: "approved" }));
    await expect(reviewer.review(request)).rejects.toMatchObject({ code: "provider-response-invalid" });
  });
});
