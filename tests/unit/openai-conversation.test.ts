import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ConversationProviderError,
  OpenAIConversationProvider,
  createOpenAIConversationProvider,
  type ConversationProviderInput,
} from "@/src/modules/providers/conversation/server";

const input: ConversationProviderInput = {
  userMessage: "Hoy he tenido un día difícil.",
  recentMessages: [{ role: "character", content: "¿Cómo te ha ido?" }],
  rollingSummary: "Hablamos de fotografía y de los planes de esta semana.",
  openTopics: [{ topicKey: "daily:meal", label: "¿Qué comiste?", status: "answered", lastMentionedBy: "user", lastAnswer: "Una ensalada." }],
  openCommitments: [{ commitmentKey: "user:plan:puerto", owner: "user", statement: "Esta tarde voy al puerto a hacer fotos.", dueHint: "later-today", status: "open" }],
  character: {
    characterKey: "lucia",
    characterVersion: 1,
    displayName: "Lucía Martín",
    homeLocation: "Madrid",
    initiative: "balanced",
    tone: ["cercana", "natural"],
    topics: ["fotografía urbana", "Madrid"],
    facts: [{ factKey: "boundary.ai-identity", statement: "Soy un personaje de IA.", sensitivity: "normal", reveal: "direct" }],
  },
  relationshipStage: "familiar",
  relationshipSummary: "Hablamos de fotografía.",
  memories: [{ factKey: "interest.preference", category: "interest", content: "la fotografía", confidence: 0.9, sensitivity: "normal", shareScope: "private" }],
  teachingOpportunity: null,
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "oa-chat-123" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("OpenAIConversationProvider", () => {
  it("sends provider-neutral context through the Responses API and maps output text", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response({ output_text: "Lo siento. ¿Quieres contarme qué ha pasado?" });
    });
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const provider = new OpenAIConversationProvider({ apiKey: "test-openai-key", modelVersion: "gpt-5.6-sol", endpoint: "https://openai.test/v1/responses", fetchImplementation, clock });

    await expect(provider.generate(input)).resolves.toEqual({
      text: "Lo siento. ¿Quieres contarme qué ha pasado?",
      provider: "openai",
      modelVersion: "gpt-5.6-sol",
      providerRequestId: "oa-chat-123",
      latencyMs: 42,
      estimatedCostMicros: null,
    });
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>).authorization).toBe("Bearer test-openai-key");
    expect(body.model).toBe("gpt-5.6-sol");
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).toContain(input.userMessage);
    expect(JSON.stringify(body)).toContain("la fotografía");
    expect(JSON.stringify(body)).toContain("daily:meal");
    expect(JSON.stringify(body)).toContain("puerto");
    expect(JSON.stringify(body)).not.toContain("test-openai-key");
  });

  it("extracts text blocks when output_text is absent", async () => {
    const provider = new OpenAIConversationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ output: [{ type: "message", content: [{ type: "output_text", text: "Hola.", annotations: [], logprobs: [], phase: "final_answer" }] }] })),
    });
    await expect(provider.generate(input)).resolves.toMatchObject({ text: "Hola.", provider: "openai" });
  });

  it("rejects missing configuration and malformed output", async () => {
    const noKey = new OpenAIConversationProvider({ apiKey: " ", fetchImplementation: vi.fn() });
    await expect(noKey.generate(input)).rejects.toMatchObject({ code: "provider-auth-failed", retryable: false });
    const malformed = new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation: vi.fn(async () => response({ output: [] })) });
    await expect(malformed.generate(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });

  it.each([
    [401, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation: vi.fn(async () => response({ error: "provider secret" }, status)) });
    await expect(provider.generate(input)).rejects.toMatchObject({ code, retryable });
  });

  it("maps timeout and caller cancellation", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) { reject(new Error("aborted")); return; }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const timeoutProvider = new OpenAIConversationProvider({ apiKey: "test-key", timeoutMs: 5, fetchImplementation });
    await expect(timeoutProvider.generate(input)).rejects.toMatchObject({ code: "provider-timeout", retryable: true });
    const controller = new AbortController();
    controller.abort();
    const cancelledProvider = new OpenAIConversationProvider({ apiKey: "test-key", fetchImplementation });
    await expect(cancelledProvider.generate(input, { signal: controller.signal })).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
  });

  it("loads server configuration through its factory", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_API_ENDPOINT", "https://env.test/responses");
    vi.stubEnv("OPENAI_CONVERSATION_MODEL", "gpt-5.6-sol");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL) => {
      void url;
      return response({ output_text: "Hola." });
    });
    const provider = createOpenAIConversationProvider({ fetchImplementation });
    await provider.generate(input);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://env.test/responses");
    vi.unstubAllEnvs();
  });

  it("keeps the default endpoint when the configured value is blank", async () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_API_ENDPOINT", "");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL) => {
      void url;
      return response({ output_text: "Hola." });
    });
    const provider = createOpenAIConversationProvider({ fetchImplementation });
    await provider.generate(input);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/responses");
    vi.unstubAllEnvs();
  });

  it("exposes stable typed errors", () => {
    const error = new ConversationProviderError("provider-unavailable", "temporary", true);
    expect(error).toMatchObject({ code: "provider-unavailable", retryable: true });
  });
});
