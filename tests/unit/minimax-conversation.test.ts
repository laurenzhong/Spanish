import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConversationProviderError,
  MiniMaxConversationProvider,
  createMiniMaxConversationProvider,
  type ConversationProviderInput,
} from "@/src/modules/providers/conversation/server";

const input: ConversationProviderInput = {
  userMessage: "Hoy he tenido un día difícil.",
  recentMessages: [{ role: "character", content: "¿Cómo te ha ido?" }],
  rollingSummary: "Hablamos de fotografía y de los planes de esta semana.",
  openTopics: [{ topicKey: "daily:meal", label: "¿Qué comiste?", status: "answered", lastMentionedBy: "user", lastAnswer: "Una ensalada." }],
  character: {
    characterKey: "lucia",
    characterVersion: 1,
    displayName: "Lucía Martín",
    homeLocation: "Madrid",
    initiative: "balanced",
    tone: ["cercana", "natural"],
    topics: ["fotografía urbana", "Madrid"],
    facts: [{
      factKey: "boundary.ai-identity",
      statement: "Soy un personaje de IA.",
      sensitivity: "normal",
      reveal: "direct",
    }],
  },
  relationshipStage: "familiar",
  relationshipSummary: "Hablamos de fotografía.",
  memories: [{
    factKey: "interest.preference",
    category: "interest",
    content: "la fotografía",
    confidence: 0.9,
    sensitivity: "normal",
    shareScope: "private",
  }],
  teachingOpportunity: null,
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "mmx-chat-123" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("MiniMaxConversationProvider", () => {
  it("sends privacy-filtered context and returns generated text metadata", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response({ content: [{ type: "text", text: "Lo siento. ¿Quieres contarme qué ha pasado?" }] });
    });
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const provider = new MiniMaxConversationProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation,
      clock,
    });

    await expect(provider.generate(input)).resolves.toEqual({
      text: "Lo siento. ¿Quieres contarme qué ha pasado?",
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "mmx-chat-123",
      latencyMs: 42,
      estimatedCostMicros: null,
    });
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>) ["x-api-key"]).toBe("test-minimax-key");
    expect(body.model).toBe("MiniMax-M3");
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).toContain(input.userMessage);
    expect(JSON.stringify(body)).toContain("la fotografía");
    expect(JSON.stringify(body)).toContain("daily:meal");
    expect(JSON.stringify(body)).not.toContain("test-minimax-key");
  });

  it("rejects missing configuration and malformed output", async () => {
    const noKey = new MiniMaxConversationProvider({ apiKey: " ", fetchImplementation: vi.fn() });
    await expect(noKey.generate(input)).rejects.toMatchObject({ code: "provider-auth-failed", retryable: false });

    const malformed = new MiniMaxConversationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ content: [{ type: "text", text: "" }] })),
    });
    await expect(malformed.generate(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });

  it.each([
    [401, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = new MiniMaxConversationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ error: "provider secret" }, status)),
    });
    await expect(provider.generate(input)).rejects.toMatchObject({ code, retryable });
  });

  it("maps timeout and caller cancellation without exposing provider errors", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const timeoutProvider = new MiniMaxConversationProvider({ apiKey: "test-key", timeoutMs: 5, fetchImplementation });
    await expect(timeoutProvider.generate(input)).rejects.toMatchObject({ code: "provider-timeout", retryable: true });

    const controller = new AbortController();
    controller.abort();
    const cancelledProvider = new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation });
    await expect(cancelledProvider.generate(input, { signal: controller.signal })).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("loads server configuration through its factory", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "https://env.test/messages");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      void url;
      void init;
      return response({ content: [{ type: "text", text: "Hola." }] });
    });
    const provider = createMiniMaxConversationProvider({ fetchImplementation });
    await provider.generate(input);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://env.test/messages");
    vi.unstubAllEnvs();
  });

  it("exposes stable typed errors", () => {
    const error = new ConversationProviderError("provider-unavailable", "temporary", true);
    expect(error).toMatchObject({ code: "provider-unavailable", retryable: true });
  });
});
