import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxAnnotationDraftProvider } from "@/src/modules/providers/annotation/server";
import { createMiniMaxLexiconExtractionProvider } from "@/src/modules/providers/lexicon-extraction/minimax-lexicon-extraction";
import type { AnnotationDraftInput } from "@/src/modules/providers/annotation";

/**
 * Regression coverage for the vendor request id.
 *
 * AGENTS.md section 7 requires recording the provider's request id. Both
 * adapters read only `x-request-id`, but `api.minimaxi.com` never sends that
 * header — it sends `x-mm-request-id`, plus `trace-id` and `x-session-id` — so
 * every successful call recorded `null`. That was found by looking at the real
 * response headers, not from any fixture, because the fixtures all invented
 * `x-request-id` and therefore agreed with the bug.
 *
 * The header names below are the ones actually observed from the live endpoint.
 */

const annotationInput: AnnotationDraftInput = {
  transcript: "Ayer fui al mercado.",
  locale: "es-ES",
  contentVersion: "request-id-001",
  attemptId: "00000000-0000-4000-8000-0000000000bb",
  generationId: 1,
  speechSignal: null,
};

type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

const extractionBody = { content: [{ type: "text", text: JSON.stringify({ proposals: [] }) }] };
const annotationBody = {
  content: [
    {
      type: "text",
      text: JSON.stringify({ summary: "ok", observations: [], questionsForReviewer: [] }),
    },
  ],
};

async function extractionRequestId(headers: Record<string, string>): Promise<string | null> {
  const fetchImplementation: FetchSeam = async () => jsonResponse(extractionBody, headers);
  const provider = createMiniMaxLexiconExtractionProvider({
    apiKey: "test-key",
    fetchImplementation,
  });
  const result = await provider.extractCandidates({
    language: "es",
    segments: [
      {
        documentKind: "article",
        documentStableKey: "request.id",
        documentVersion: 1,
        segmentIndex: 0,
        sourceText: "Una casa.",
        translation: null,
        sourceTitle: "t",
        sourceKind: "article-rss",
      },
    ],
    maxCandidatesPerSegment: 5,
  });
  return result.providerRequestId;
}

async function annotationRequestId(headers: Record<string, string>): Promise<string | null> {
  const fetchImplementation: FetchSeam = async () => jsonResponse(annotationBody, headers);
  const provider = new MiniMaxAnnotationDraftProvider({
    apiKey: "test-key",
    fetchImplementation,
  });
  const draft = await provider.createDraft(annotationInput);
  return draft.providerRequestId;
}

describe("vendor request id is read from the headers the endpoint actually sends", () => {
  it("records x-mm-request-id for the extraction adapter", async () => {
    await expect(
      extractionRequestId({ "x-mm-request-id": "1996384806555882409_1791679520ttclzq" }),
    ).resolves.toBe("1996384806555882409_1791679520ttclzq");
  });

  it("records x-mm-request-id for the annotation adapter", async () => {
    await expect(
      annotationRequestId({ "x-mm-request-id": "1996384806555882409_1791679523x25v93" }),
    ).resolves.toBe("1996384806555882409_1791679523x25v93");
  });

  it("falls back to trace-id when the vendor omits x-mm-request-id", async () => {
    await expect(extractionRequestId({ "trace-id": "071a0ef328059f890aa0baa58b2417aa" })).resolves.toBe(
      "071a0ef328059f890aa0baa58b2417aa",
    );
    await expect(annotationRequestId({ "trace-id": "071a0ef328059f890aa0baa58b2417aa" })).resolves.toBe(
      "071a0ef328059f890aa0baa58b2417aa",
    );
  });

  it("prefers x-mm-request-id over the less specific names", async () => {
    await expect(
      extractionRequestId({
        "x-mm-request-id": "mm",
        "trace-id": "trace",
        "x-request-id": "plain",
      }),
    ).resolves.toBe("mm");
  });

  it("still accepts x-request-id, which other vendors and some proxies send", async () => {
    await expect(extractionRequestId({ "x-request-id": "plain" })).resolves.toBe("plain");
    await expect(annotationRequestId({ "x-request-id": "plain" })).resolves.toBe("plain");
  });

  it("reports null rather than inventing an id when no such header is present", async () => {
    await expect(extractionRequestId({ "content-type": "application/json" })).resolves.toBeNull();
    await expect(annotationRequestId({ "content-type": "application/json" })).resolves.toBeNull();
  });
});
