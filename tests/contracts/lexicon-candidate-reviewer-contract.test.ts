import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createFakeLexiconCandidateReviewer,
  fakeLexiconReviewCandidate,
  fakeLexiconReviewNow,
  MiniMaxLexiconReviewError,
  validateLexiconReviewSnapshot,
} from "@/src/modules/providers/lexicon-review";
import {
  MiniMaxCandidateReviewer,
  lexiconReviewIdentity,
  type MiniMaxCandidateReviewDecision,
} from "@/src/modules/providers/lexicon-review/server";
import {
  OWNER_AUTHORIZED_REVIEWER_REFERENCE,
  isOwnerAuthorizedReviewerReference,
} from "@/src/modules/content-acquisition/domain/review-identity";
import type {
  CandidateReviewDecision,
  CandidateReviewRequest,
  CandidateReviewer,
} from "@/src/modules/lexicon-corpus/application/candidate-reviewer";
import {
  lexiconReviewDimensionValues,
  lexiconReviewOutcomeValues,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";

/**
 * Contract tests for the lexicon candidate review port (AGENTS.md §10: provider
 * adapters need a contract test and a fake).
 *
 * Both implementations are exercised through the seam's own interface. The
 * adapter test injects a fetch seam, so this file never calls the vendor — the
 * real call lives only in `scripts/smoke-lexicon-review.ts`.
 */

const dimensions = lexiconReviewDimensionValues;

function request(dimension: CandidateReviewRequest["dimension"]): CandidateReviewRequest {
  return { candidate: fakeLexiconReviewCandidate(), dimension };
}

function anthropicVerdict(dimension: CandidateReviewRequest["dimension"], outcome: "pass" | "fail"): Response {
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            outcome,
            dimension,
            languageVerdict: "La forma aparece en el contexto congelado y se usa como sustantivo.",
            teachingVerdict: "La explicación china corresponde al sentido español, sin omisiones.",
            reason:
              outcome === "pass"
                ? "El contexto respalda la forma, la categoría y la explicación."
                : "La explicación no cubre el sentido completo del contexto.",
            evidence: ["un terremoto de magnitud 7.2"],
            issues: outcome === "pass" ? [] : ["La explicación omite la magnitud."],
          }),
        },
      ],
      stop_reason: "end_turn",
    }),
    { status: 200, headers: { "content-type": "application/json", "x-request-id": "contract-1" } },
  );
}

describe("fake lexicon candidate reviewer (contract fake)", () => {
  it("satisfies the seam for both dimensions and passes by default", async () => {
    const reviewer: CandidateReviewer = createFakeLexiconCandidateReviewer();

    for (const dimension of dimensions) {
      const decision = await reviewer.review(request(dimension));
      expect(decision.dimension).toBe(dimension);
      expect(decision.outcome).toBe("pass");
      expect(decision.reviewedAt).toEqual(fakeLexiconReviewNow);
    }

    const asFake = createFakeLexiconCandidateReviewer();
    await asFake.review(request(dimensions[0]));
    expect(asFake.calls).toHaveLength(1);
  });

  it("writes an identity the corpus gate accepts", async () => {
    const reviewer = createFakeLexiconCandidateReviewer();
    const decision = await reviewer.review(request("content-es-ES"));
    expect(isOwnerAuthorizedReviewerReference(decision.reviewerReference)).toBe(true);
    expect(decision.reviewerReference.startsWith(OWNER_AUTHORIZED_REVIEWER_REFERENCE)).toBe(true);
  });

  it("can answer fail, so the settle-as-rejected path is reachable in tests", async () => {
    const reviewer = createFakeLexiconCandidateReviewer({ outcomes: { "teaching-zh-CN": "fail" } });
    const decision = await reviewer.review(request("teaching-zh-CN"));
    expect(decision.outcome).toBe("fail");
    expect(lexiconReviewOutcomeValues).toContain(decision.outcome);
  });

  it("can model a reviewer that answers the wrong dimension", async () => {
    const reviewer = createFakeLexiconCandidateReviewer({
      respond: () => ({
        dimension: "teaching-zh-CN",
        outcome: "pass",
        reviewerReference: lexiconReviewIdentity,
        reviewedAt: fakeLexiconReviewNow,
      }),
    });
    const decision: CandidateReviewDecision = await reviewer.review(request("content-es-ES"));
    // The pipeline (not this fake) is what refuses it; the fake has to be able to
    // produce the shape or that pipeline test could not exist.
    expect(decision.dimension).toBe("teaching-zh-CN");
  });

  it("can model a reviewer that throws", async () => {
    const reviewer = createFakeLexiconCandidateReviewer({ error: new Error("reviewer down") });
    await expect(reviewer.review(request("content-es-ES"))).rejects.toThrow("reviewer down");
  });

  it("can model an unauthorised identity", async () => {
    const reviewer = createFakeLexiconCandidateReviewer({ reviewerReference: "self-certified-by-extractor" });
    const decision = await reviewer.review(request("content-es-ES"));
    expect(isOwnerAuthorizedReviewerReference(decision.reviewerReference)).toBe(false);
  });
});

describe("MiniMax candidate reviewer conforms to the seam", () => {
  it("is usable as a CandidateReviewer and carries its decision through unchanged", async () => {
    const adapter = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => anthropicVerdict("content-es-ES", "pass")),
    });
    const reviewer: CandidateReviewer = adapter;

    const decision: CandidateReviewDecision = await reviewer.review(request("content-es-ES"));

    // Exactly one dimension, exactly one verdict, owner-authorized AI identity.
    expect(decision.dimension).toBe("content-es-ES");
    expect(decision.outcome).toBe("pass");
    expect(isOwnerAuthorizedReviewerReference(decision.reviewerReference)).toBe(true);
    expect(decision.reviewerReference).toBe(lexiconReviewIdentity);
    expect(decision.reviewedAt.getTime()).toBeGreaterThan(0);
  });

  it("returns the rich decision structurally assignable to the seam's decision", async () => {
    const adapter = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => anthropicVerdict("teaching-zh-CN", "fail")),
    });

    const rich: MiniMaxCandidateReviewDecision = await adapter.review(request("teaching-zh-CN"));
    const seamShaped: CandidateReviewDecision = rich;

    expect(seamShaped.outcome).toBe("fail");
    expect(rich.observation.provider).toBe("minimax");
    expect(rich.observation.dimension).toBe("teaching-zh-CN");
    expect(rich.observation.providerRequestId).toBe("contract-1");
  });

  it("prompts each dimension separately and never asks for both in one call", async () => {
    const bodies: string[] = [];
    const adapter = new MiniMaxCandidateReviewer({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const body = String(init?.body);
        bodies.push(body);
        const asked = JSON.parse(body).messages[0].content[0].text as string;
        return anthropicVerdict(asked.includes("teaching-zh-CN") ? "teaching-zh-CN" : "content-es-ES", "pass");
      }),
    });

    await adapter.review(request("content-es-ES"));
    await adapter.review(request("teaching-zh-CN"));

    expect(bodies).toHaveLength(2);
    const askedOf = (body: string) => JSON.parse(JSON.parse(body).messages[0].content[0].text) as Record<string, unknown>;
    expect(askedOf(bodies[0]).dimension).toBe("content-es-ES");
    expect(askedOf(bodies[1]).dimension).toBe("teaching-zh-CN");
    expect(askedOf(bodies[0]).task).toBe("review_lexicon_candidate");
  });
});

describe("frozen snapshot guard", () => {
  const valid = {
    candidateId: "c",
    kind: "lexeme" as const,
    dimension: "content-es-ES" as const,
    surfaceText: "terremoto",
    normalizedText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    meaningZh: null,
    documentKind: "article" as const,
    documentStableKey: "article.a",
    documentVersion: 1,
    segmentIndex: 0,
    contextBefore: "un",
    contextAfter: "de magnitud 7.2",
  };

  it("accepts a complete frozen snapshot", () => {
    expect(() => validateLexiconReviewSnapshot(valid)).not.toThrow();
  });

  it("refuses a snapshot the model could not judge, before any call", () => {
    const cases = [
      { ...valid, candidateId: "" },
      { ...valid, surfaceText: " " },
      { ...valid, documentVersion: 0 },
      { ...valid, segmentIndex: -1 },
      { ...valid, contextBefore: "", contextAfter: "" },
      { ...valid, kind: "sentence" as never },
    ];
    for (const value of cases) {
      expect(() => validateLexiconReviewSnapshot(value)).toThrow(MiniMaxLexiconReviewError);
    }
  });
});
