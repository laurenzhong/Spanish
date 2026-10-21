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
  unansweredUserMessages: ["Me gusta leer.", "Hoy he tenido un día difícil."],
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
    const serializedContext = JSON.parse((body.messages as { content: { text: string }[] }[])[0]!.content[0]!.text);
    expect(serializedContext.unansweredUserMessages).toEqual(input.unansweredUserMessages);
    expect(JSON.stringify(body)).toContain("la fotografía");
    expect(JSON.stringify(body)).toContain("daily:meal");
    expect(JSON.stringify(body)).toContain("puerto");
    expect(JSON.stringify(body)).not.toContain("test-minimax-key");
  });

  it("keeps the latest declarative update and chronological history distinct from character rules", async () => {
    let body: Record<string, unknown> = {};
    const latest = "Por la tarde me fui a currar.";
    const history = [
      { role: "character" as const, content: "¿Prefieres pasear o tomar un café?", sentAt: "2026-10-16T08:18:00Z" },
      { role: "user" as const, content: "Sí, hoy es fin de semana.", sentAt: "2026-10-16T08:24:00Z" },
    ];
    const character = { ...input.character, responseStyle: ["responde primero a lo que la otra persona quiso decir"] };
    const provider = new MiniMaxConversationProvider({ apiKey: "test-key", fetchImplementation: vi.fn(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return response({ content: [{ type: "text", text: "Vaya, currando en finde." }] });
    }) });
    await provider.generate({ ...input, userMessage: latest, recentMessages: history, character });
    const messages = body.messages as { role: string; content: { type: string; text: string }[] }[];
    const sent = JSON.parse(messages[0]!.content[0]!.text);
    expect(sent.userMessage).toBe(latest);
    expect(sent.recentMessages).toEqual(history);
    expect(sent.character).toEqual(character);
    expect(sent.openCommitments).toEqual(input.openCommitments);
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

  it("keeps the default endpoint when the configured value is blank", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL) => {
      void url;
      return response({ content: [{ type: "text", text: "Hola." }] });
    });
    const provider = createMiniMaxConversationProvider({ fetchImplementation });
    await provider.generate(input);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://api.minimaxi.com/anthropic/v1/messages");
    vi.unstubAllEnvs();
  });

  it("exposes stable typed errors", () => {
    const error = new ConversationProviderError("provider-unavailable", "temporary", true);
    expect(error).toMatchObject({ code: "provider-unavailable", retryable: true });
  });
});
