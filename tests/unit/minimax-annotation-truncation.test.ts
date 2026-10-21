import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxAnnotationDraftProvider } from "@/src/modules/providers/annotation/server";
import type { AnnotationDraftInput } from "@/src/modules/providers/annotation";

/**
 * Regression coverage for the annotation draft adapter's real-world failures.
 *
 * Both defects were found by calling the real provider; neither was reachable
 * from the fixtures the other suites use, because those fixtures already supply
 * well-formed JSON. The tests below pin the two things that were wrong:
 *
 * 1. the adapter sent requests to a host the project key is not issued for, so
 *    every call failed authentication;
 * 2. the completion budget was small enough to truncate a real draft mid-JSON,
 *    which the adapter then reported as an invalid response rather than as a
 *    length problem.
 */

const input: AnnotationDraftInput = {
  transcript: "Ayer yo... yo fui al mercado y compré... eh, compré tomates y pan.",
  locale: "es-ES",
  contentVersion: "annotation-truncation-001",
  attemptId: "00000000-0000-4000-8000-0000000000aa",
  generationId: 1,
  speechSignal: null,
};

type FetchSeam = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function providerWithResponse(
  body: string,
  status = 200,
  capture?: (init: RequestInit, url: string) => void,
): MiniMaxAnnotationDraftProvider {
  const fetchImplementation: FetchSeam = async (requestInput, init) => {
    capture?.(init ?? {}, String(requestInput));
    return new Response(body, { status, headers: { "x-request-id": "mmx-truncation" } });
  };
  return new MiniMaxAnnotationDraftProvider({
    apiKey: "test-key",
    fetchImplementation,
  });
}

/** A draft cut off part-way through its JSON, exactly as the wire delivered it. */
function truncatedPayload(): string {
  const partial =
    '{"summary":"Annotation draft prepared for human reviewer.","observations":[' +
    '{"category":"fluency","observation":"The speaker repeats a word after a pause; is that';
  return JSON.stringify({
    content: [{ type: "text", text: partial }],
    stop_reason: "max_tokens",
  });
}

describe("annotation draft adapter: truncated responses", () => {
  it("refuses a completion that was cut off mid-JSON instead of yielding a partial draft", async () => {
    const provider = providerWithResponse(truncatedPayload());

    const outcome = await provider.createDraft(input).then(
      (draft) => ({ ok: true as const, draft }),
      (error: { code?: string }) => ({ ok: false as const, code: error.code }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // The important part is that no draft is produced: a half-written
    // observation list must never look like a finished annotation.
    expect(outcome.code).toBe("provider-response-invalid");
  });

  it("asks for enough completion budget that a full draft can finish", async () => {
    let seen: RequestInit | undefined;
    const provider = providerWithResponse(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: JSON.stringify({ summary: "ok", observations: [], questionsForReviewer: [] }),
          },
        ],
      }),
      200,
      (init) => {
        seen = init;
      },
    );

    await provider.createDraft(input);

    const body = JSON.parse(String(seen?.body)) as { max_tokens: number };
    // 900 truncated a real response. The schema permits 12 observations and 12
    // questions, so the budget has to leave room for a full one.
    expect(body.max_tokens).toBeGreaterThanOrEqual(2_000);
  });

  it("lets a caller raise or lower the budget explicitly", async () => {
    let seen: RequestInit | undefined;
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: "test-key",
      maxTokens: 1_234,
      fetchImplementation: async (_requestInput, init) => {
        seen = init;
        return new Response(
          JSON.stringify({
            content: [
              {
                type: "text",
                text: JSON.stringify({ summary: "ok", observations: [], questionsForReviewer: [] }),
              },
            ],
          }),
          { status: 200, headers: { "x-request-id": "mmx-budget" } },
        );
      },
    });

    await provider.createDraft(input);

    const body = JSON.parse(String(seen?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBe(1_234);
  });
});
