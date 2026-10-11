import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxLexiconExtractionProvider,
  createMiniMaxLexiconExtractionProvider,
} from "@/src/modules/providers/lexicon-extraction/server";
import {
  LexiconExtractionError,
  type LexiconExtractionInput,
} from "@/src/modules/providers/lexicon-extraction";

const segment = {
  documentKind: "article" as const,
  documentStableKey: "article.a",
  documentVersion: 1,
  segmentIndex: 0,
  sourceText: "Y en Panamá un terremoto de magnitud 7.2 acudió el sureste del país.",
  translation: "在巴拿马，一场7.2级地震袭击了该国东南部。",
  sourceTitle: "Alerta de tsunami",
  sourceKind: "article-rss",
};

const input: LexiconExtractionInput = { language: "es", segments: [segment], maxCandidatesPerSegment: 50 };

/** Mirrors the adapter's fetch seam so both the URL and the init stay inspectable. */
type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function anthropicResponse(proposals: unknown, headers: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ proposals }) }] }),
    { status: 200, headers: { "content-type": "application/json", ...headers } },
  );
}

function providerWithResponse(response: Response, extra: Record<string, unknown> = {}) {
  const fetchImplementation = vi.fn<FetchSeam>(async () => response);
  const provider = new MiniMaxLexiconExtractionProvider({
    apiKey: "test-key",
    fetchImplementation,
    clock: () => 1_000,
    ...extra,
  });
  return { provider, fetchImplementation };
}

function providerWithFetch(fetchImplementation: FetchSeam, extra: Record<string, unknown> = {}) {
  const provider = new MiniMaxLexiconExtractionProvider({
    apiKey: "test-key",
    fetchImplementation,
    clock: () => 1_000,
    ...extra,
  });
  return { provider };
}

function lexemeProposal(overrides: Record<string, unknown> = {}) {
  return {
    kind: "lexeme",
    surfaceText: "terremoto",
    lemma: "terremoto",
    partOfSpeech: "NOUN",
    // Required by the contract: the teaching review judges this gloss, so a
    // lexeme without one is dropped by the adapter rather than reviewed.
    meaningZh: "地震",
    segmentIndex: 0,
    confidence: 0.9,
    ...overrides,
  };
}

describe("MiniMax lexicon extraction adapter", () => {
  it("fails closed when no api key is configured", async () => {
    const provider = createMiniMaxLexiconExtractionProvider({ apiKey: "", fetchImplementation: vi.fn() });
    await expect(provider.extractCandidates(input)).rejects.toMatchObject({
      code: "provider-auth-failed",
      retryable: false,
    });
  });

  it("sends only text, and never claims evidence side effects", async () => {
    const { provider, fetchImplementation } = providerWithResponse(anthropicResponse([lexemeProposal()]));

    const result = await provider.extractCandidates(input);

    const init = fetchImplementation.mock.calls[0][1];
    const serialized = String(init?.body);
    // The segment text is the only content sent.
    expect(serialized).toContain("terremoto");
    expect(serialized).not.toContain("data:audio");
    // And the constraints state the safety position explicitly.
    expect(serialized).toContain("ownerApprovalRequired");

    expect(result.safety).toEqual({
      audioSent: false,
      writesEvidence: false,
      affectsMastery: false,
      affectsConfidence: false,
      needsOwnerApproval: true,
    });
    expect(result.provider).toBe("minimax");
    expect(result.modelVersion).toBe("MiniMax-M3");
  });

  it("keeps a well-formed lexeme proposal, including its gloss", async () => {
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal()]));
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toEqual([
      {
        kind: "lexeme",
        surfaceText: "terremoto",
        normalizedText: "terremoto",
        lemma: "terremoto",
        partOfSpeech: "NOUN",
        // The gloss survives the adapter now. It used to be forced to null here,
        // which is what guaranteed the teaching review would reject every lexeme.
        meaningZh: "地震",
        segmentIndex: 0,
        confidence: 0.9,
      },
    ]);
  });

  it("drops a lexeme that arrives without a gloss, rather than paying to review it", async () => {
    // Dropping is deliberate: a gloss-less lexeme cannot pass the teaching
    // dimension, so requesting a verdict for it would spend a call to learn
    // something already known.
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ meaningZh: null })]));
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(0);
  });

  it("drops a lexeme that arrives with a null dictionary form", async () => {
    // A null lemma passes the payload schema and is dropped per-proposal, so one
    // bad candidate does not cost the whole batch.
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ lemma: null })]));
    expect((await provider.extractCandidates(input)).proposals).toHaveLength(0);
  });

  it("rejects the whole payload when a dictionary form is present but blank", async () => {
    // A blank string is a different failure from a missing one: the schema's
    // `.trim().min(1)` refuses it before the sanitiser runs, so the batch fails.
    // Both behaviours are asserted because they take different paths, and losing
    // either would let a claim through unexamined.
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ lemma: "   " })]));
    await expect(provider.extractCandidates(input)).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });
  });

  it("drops a proposal whose surface form is not in the segment it cites (hallucination guard)", async () => {
    const { provider } = providerWithResponse(
      anthropicResponse([lexemeProposal({ surfaceText: "hipopótamo", lemma: "hipopótamo" })]),
    );
    const result = await provider.extractCandidates(input);
    // Accepting it would create a corpus occurrence pointing at text that does
    // not contain the word.
    expect(result.proposals).toHaveLength(0);
  });

  it("drops a proposal citing a segment outside the request", async () => {
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ segmentIndex: 7 })]));
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(0);
  });

  it("discards a part of speech outside the controlled set instead of storing it as fact", async () => {
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ partOfSpeech: "NOUNISH" })]));
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].partOfSpeech).toBeNull();
  });

  it("keeps a lexeme that carries a gloss, because that is now the required shape", async () => {
    // This case used to sit in the malformed bucket: a lexeme with a translation
    // was cross-kind. The rule inverted when the teaching dimension made the
    // gloss mandatory, so the same input is now exactly what the contract asks
    // for — and asserting it positively is what stops the old rule creeping back.
    const { provider } = providerWithResponse(anthropicResponse([lexemeProposal({ meaningZh: "地震" })]));
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].meaningZh).toBe("地震");
  });

  it("drops a phrase that carries a lemma", async () => {
    // The surviving half of the cross-kind rule: a lemma on a phrase would claim
    // a dictionary form for a whole sentence.
    const { provider } = providerWithResponse(
      anthropicResponse([
        {
          kind: "phrase",
          surfaceText: "un terremoto",
          lemma: "terremoto",
          partOfSpeech: null,
          meaningZh: "一场地震",
          segmentIndex: 0,
          confidence: 0.9,
        },
      ]),
    );
    expect((await provider.extractCandidates(input)).proposals).toHaveLength(0);
  });

  it("keeps a well-formed phrase, gloss and no lemma", async () => {
    const { provider } = providerWithResponse(
      anthropicResponse([
        {
          kind: "phrase",
          surfaceText: "un terremoto",
          lemma: null,
          partOfSpeech: null,
          meaningZh: "一场地震",
          segmentIndex: 0,
          confidence: 0.9,
        },
      ]),
    );
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ kind: "phrase", lemma: null, meaningZh: "一场地震" });
  });

  it("enforces the per-segment bound even when the model over-produces", async () => {
    const proposals = Array.from({ length: 12 }, () => lexemeProposal({ confidence: 0.5 }));
    const { provider } = providerWithResponse(anthropicResponse(proposals));
    const result = await provider.extractCandidates({ ...input, maxCandidatesPerSegment: 4 });
    expect(result.proposals).toHaveLength(4);
  });

  it("maps auth, rate-limit and server failures to distinct coded errors", async () => {
    const cases: readonly (readonly [number, string, boolean])[] = [
      [401, "provider-auth-failed", false],
      [403, "provider-auth-failed", false],
      [429, "provider-rate-limited", true],
      [503, "provider-unavailable", true],
      [400, "provider-response-invalid", false],
    ];
    for (const [status, code, retryable] of cases) {
      const { provider } = providerWithResponse(new Response("nope", { status }));
      await expect(provider.extractCandidates(input)).rejects.toMatchObject({ code, retryable });
    }
  });

  it("rejects a response that is not the expected shape", async () => {
    const empty = providerWithResponse(new Response(JSON.stringify({ content: [] }), { status: 200 }));
    await expect(empty.provider.extractCandidates(input)).rejects.toMatchObject({
      code: "provider-response-invalid",
    });

    const notJson = providerWithResponse(new Response("plain text", { status: 200 }));
    await expect(notJson.provider.extractCandidates(input)).rejects.toBeInstanceOf(LexiconExtractionError);
  });

  it("accepts JSON wrapped in a fenced code block", async () => {
    const fenced = new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text:
              "```json\n" +
              JSON.stringify({ proposals: [lexemeProposal({ confidence: 0.8 })] }) +
              "\n```",
          },
        ],
      }),
      { status: 200 },
    );
    const { provider } = providerWithResponse(fenced);
    const result = await provider.extractCandidates(input);
    expect(result.proposals).toHaveLength(1);
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

    const timedOut = providerWithFetch(hangingFetch, { timeoutMs: 5 });
    await expect(timedOut.provider.extractCandidates(input)).rejects.toMatchObject({
      code: "provider-timeout",
      retryable: true,
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = providerWithFetch(hangingFetch);
    await expect(cancelled.provider.extractCandidates(input, { signal: controller.signal })).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
  });

  it("propagates the provider request id when the response carries one", async () => {
    const { provider } = providerWithResponse(anthropicResponse([], { "x-request-id": "req-123" }));
    const result = await provider.extractCandidates(input);
    expect(result.providerRequestId).toBe("req-123");
  });

  it("refuses a non-Spanish batch before calling the provider", async () => {
    const { provider, fetchImplementation } = providerWithResponse(anthropicResponse([]));
    await expect(provider.extractCandidates({ ...input, language: "en" })).rejects.toMatchObject({
      code: "input-invalid",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
