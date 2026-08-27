import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxStoryGenerationProvider,
  StoryGenerationError,
  createMiniMaxStoryGenerationProvider,
  type StoryGenerationInput,
} from "@/src/modules/providers/story-generation/server";

const input: StoryGenerationInput = {
  prompt: "Una persona conoce a alguien nuevo en un huerto comunitario.",
  cefr: "B1",
  length: "medium",
  format: "story",
  keywords: ["amistad", "café"],
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "mmx-story-123" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const story = {
  title: "Una tarde en el huerto",
  summary: "Una conversación sencilla abre una nueva amistad.",
  segments: ["Marta llegó al huerto comunitario después del trabajo.", "Allí conoció a Diego y hablaron durante un rato."],
  cefr: "B1",
  topics: ["amistad", "comunidad"],
  register: "neutral",
};

describe("MiniMaxStoryGenerationProvider", () => {
  it("sends only generation inputs and returns validated story metadata", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response({ content: [{ type: "text", text: JSON.stringify(story) }] });
    });
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1045);
    const provider = new MiniMaxStoryGenerationProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation,
      clock,
    });

    await expect(provider.generate(input)).resolves.toEqual({
      ...story,
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "mmx-story-123",
      latencyMs: 45,
      estimatedCostMicros: null,
    });
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>)["x-api-key"]).toBe("test-minimax-key");
    expect(body.model).toBe("MiniMax-M3");
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).toContain(input.prompt);
    expect(JSON.stringify(body)).toContain("privateDraft");
    expect(JSON.stringify(body)).not.toContain("test-minimax-key");
  });

  it("rejects missing configuration and malformed JSON output", async () => {
    const noKey = new MiniMaxStoryGenerationProvider({ apiKey: " ", fetchImplementation: vi.fn() });
    await expect(noKey.generate(input)).rejects.toMatchObject({ code: "provider-auth-failed", retryable: false });

    const malformed = new MiniMaxStoryGenerationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ content: [{ type: "text", text: "```json\\n{}\\n```" }] })),
    });
    await expect(malformed.generate(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });

  it("ignores non-text reasoning blocks returned by M3", async () => {
    const provider = new MiniMaxStoryGenerationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ content: [{ type: "thinking", thinking: "internal" }, { type: "text", text: JSON.stringify(story) }] })),
    });
    await expect(provider.generate(input)).resolves.toMatchObject({ title: story.title, segments: story.segments });
  });

  it.each([
    [401, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = new MiniMaxStoryGenerationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ error: "provider secret" }, status)),
    });
    await expect(provider.generate(input)).rejects.toMatchObject({ code, retryable });
  });

  it("maps timeout and caller cancellation", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const timeoutProvider = new MiniMaxStoryGenerationProvider({ apiKey: "test-key", timeoutMs: 5, fetchImplementation });
    await expect(timeoutProvider.generate(input)).rejects.toMatchObject({ code: "provider-timeout", retryable: true });

    const controller = new AbortController();
    controller.abort();
    const cancelledProvider = new MiniMaxStoryGenerationProvider({ apiKey: "test-key", fetchImplementation });
    await expect(cancelledProvider.generate(input, { signal: controller.signal })).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("loads server configuration through its factory", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "https://env.test/messages");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => { void url; void init; return response({ content: [{ type: "text", text: JSON.stringify(story) }] }); });
    const provider = createMiniMaxStoryGenerationProvider({ fetchImplementation });
    await provider.generate(input);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://env.test/messages");
    vi.unstubAllEnvs();
  });

  it("exposes stable typed errors", () => {
    const error = new StoryGenerationError("provider-unavailable", "temporary", true);
    expect(error).toMatchObject({ code: "provider-unavailable", retryable: true });
  });
});
