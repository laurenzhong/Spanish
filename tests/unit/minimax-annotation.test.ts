import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxAnnotationDraftProvider,
  createMiniMaxAnnotationDraftProvider,
} from "@/src/modules/providers/annotation/server";
import type { AnnotationDraftInput } from "@/src/modules/providers/annotation";

const input: AnnotationDraftInput = {
  transcript: "¿Qué tal todo?",
  locale: "es-ES",
  contentVersion: "alpha-core-v1",
  attemptId: "00000000-0000-4000-8000-000000000001",
  generationId: 4,
  speechSignal: {
    quality: "usable",
    durationMs: 1200,
    voicedRatio: 0.8,
    pauseCount: 1,
    pauseRatio: 0.1,
    analyzer: "local-signal",
    algorithmVersion: "local-signal-v1",
    latencyMs: 2,
    retentionPolicy: "ephemeral",
  },
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "mmx-123" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function successResponse() {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          summary: "需要人工复核表达是否完成交际任务。",
          observations: [
            {
              category: "fluency",
              observation: "语流摘要显示可能存在一次停顿，需结合音频人工确认。",
              evidenceBasis: "speech-signal",
              needsHumanReview: true,
            },
          ],
          questionsForReviewer: ["停顿是否影响理解？"],
        }),
      },
    ],
  };
}

describe("MiniMaxAnnotationDraftProvider", () => {
  it("sends only text and aggregate signal metadata, never original audio", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response(successResponse());
    });
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation,
      clock,
    });

    const result = await provider.createDraft(input);
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    const serialized = JSON.stringify(body);

    expect(result).toEqual({
      status: "draft",
      summary: "需要人工复核表达是否完成交际任务。",
      observations: [
        {
          category: "fluency",
          observation: "语流摘要显示可能存在一次停顿，需结合音频人工确认。",
          evidenceBasis: "speech-signal",
          needsHumanReview: true,
        },
      ],
      questionsForReviewer: ["停顿是否影响理解？"],
      safety: {
        audioSent: false,
        writesEvidence: false,
        affectsMastery: false,
        affectsConfidence: false,
      },
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "mmx-123",
      latencyMs: 42,
      estimatedCostMicros: null,
      retentionPolicy: "ephemeral",
    });
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>)["x-api-key"]).toBe("test-minimax-key");
    expect(body.model).toBe("MiniMax-M3");
    expect(serialized).toContain(input.transcript);
    expect(serialized).toContain("originalAudioIncluded");
    expect(serialized).not.toContain("audioBytes");
    expect(serialized).not.toContain("audio/webm");
    expect(serialized).not.toContain("Uint8Array");
  });

  it("rejects missing configuration before making a request", async () => {
    const fetchImplementation = vi.fn();
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: " ",
      fetchImplementation,
    });

    await expect(provider.createDraft(input)).rejects.toMatchObject({
      code: "provider-auth-failed",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [401, "provider-auth-failed", false],
    [403, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [500, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ error: "secret MiniMax details" }, status)),
    });

    const failure = provider.createDraft(input);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow("secret MiniMax details");
  });

  it("rejects malformed model output without exposing it", async () => {
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ content: [{ type: "text", text: "secret malformed output" }] })),
    });

    const failure = provider.createDraft(input);
    await expect(failure).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });
    await expect(failure).rejects.not.toThrow("secret malformed output");
  });

  it("distinguishes cancellation from its own timeout", async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const provider = new MiniMaxAnnotationDraftProvider({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 1000,
    });
    const controller = new AbortController();
    const pending = provider.createDraft(input, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("loads the API key from the server environment through its factory", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    const fetchImplementation = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        void url;
        void init;
        return response(successResponse());
      },
    );
    const provider = createMiniMaxAnnotationDraftProvider({ fetchImplementation });

    await provider.createDraft(input);
    expect((fetchImplementation.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
    vi.unstubAllEnvs();
  });
});
