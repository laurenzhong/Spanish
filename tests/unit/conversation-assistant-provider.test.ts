// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ConversationAssistantProviderInput } from "@/src/modules/providers/assistant/assistant";
import {
  MiniMaxConversationAssistantProvider,
  createMiniMaxConversationAssistantProvider,
  type MiniMaxConversationAssistantProviderOptions,
} from "@/src/modules/providers/assistant/server";

const structured = {
  answer: "可以委婉拒绝，同时保持友好。",
  suggestions: [
    {
      spanish: "Me encantaría, pero el sábado ya tengo planes.",
      chinese: "我很想去，但周六已经有安排了。",
    },
  ],
  corrections: [],
  structure: [],
  correctedSentence: null,
};

const input: ConversationAssistantProviderInput = {
  intent: "reply",
  question: "想拒绝她的邀请，怎么回？",
  targetText: null,
  characterDisplayName: "Lucía Martín",
  recentMessages: [{ role: "assistant", text: "¿Te vienes a cenar el sábado?" }],
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "assistant-request-1" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function contentResponse(payload: unknown = structured, status = 200, headers?: HeadersInit): Response {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return response({ content: [{ type: "text", text }] }, status, headers);
}

function fixture(
  fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(contentResponse()),
  options: Partial<Omit<MiniMaxConversationAssistantProviderOptions, "apiKey">> & { apiKey?: string } = {},
) {
  return {
    fetchImplementation,
    provider: new MiniMaxConversationAssistantProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      modelVersion: "test-model",
      fetchImplementation,
      timeoutMs: 100,
      ...options,
    }),
  };
}

function requestBody(fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>) {
  return JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

function promptPayload(fetchImplementation: ReturnType<typeof vi.fn<typeof fetch>>) {
  const messages = requestBody(fetchImplementation).messages as Array<{ content: Array<{ text: string }> }>;
  return JSON.parse(messages[0]!.content[0]!.text) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("MiniMax conversation assistant provider", () => {
  it("serializes the Anthropic request and validates the JSON answer", async () => {
    const clock = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_042);
    const { provider, fetchImplementation } = fixture(undefined, { clock });

    const result = await provider.assist(input);

    expect(result).toEqual({
      ...structured,
      provider: "minimax",
      modelVersion: "test-model",
      providerRequestId: "assistant-request-1",
      latencyMs: 42,
      estimatedCostMicros: null,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://minimax.test/anthropic/v1/messages");
    const init = fetchImplementation.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "test-minimax-key",
    });
    const body = requestBody(fetchImplementation);
    expect(body).toMatchObject({
      model: "test-model",
      max_tokens: 1_500,
      thinking: { type: "disabled" },
      stream: false,
      messages: [{ role: "user" }],
    });
    const system = String(body.system);
    expect(system).toContain("Simplified Chinese");
    expect(system).toContain("es-ES");
    expect(system).toContain("JSON object");
    expect(system).toContain("Never invent facts");
    expect(system).toContain("untrusted conversation data");
    expect(promptPayload(fetchImplementation)).toEqual({
      intent: "reply",
      question: input.question,
      targetText: null,
      characterDisplayName: "Lucía Martín",
      recentMessages: input.recentMessages,
    });
  });

  it.each([
    ["reply", { question: "怎么礼貌地答应？", targetText: null }],
    ["grammar", { question: null, targetText: "Yo soy cansado." }],
    ["structure", { question: null, targetText: "Lucía compró flores ayer." }],
    ["question", { question: "querer 和 amar 有什么区别？", targetText: null }],
  ] as const)("answers the %s intent with a validated JSON payload", async (intent, patch) => {
    const { provider, fetchImplementation } = fixture();
    const result = await provider.assist({ ...input, intent, ...patch });
    expect(result.answer).toBe(structured.answer);
    expect(promptPayload(fetchImplementation)).toMatchObject({ intent, ...patch });
  });

  it("parses a JSON object wrapped in a markdown code fence", async () => {
    const fenced = "```json\n" + JSON.stringify(structured) + "\n```";
    const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse(fenced)));
    await expect(provider.assist(input)).resolves.toMatchObject({ answer: structured.answer, provider: "minimax" });
  });

  it("parses a fenced JSON object that also contains spaces around the fence", async () => {
    const fenced = "  ```json\n" + JSON.stringify(structured) + "\n```  ";
    const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse(fenced)));
    await expect(provider.assist(input)).resolves.toMatchObject({ answer: structured.answer });
  });

  it("rejects invalid JSON, invalid envelopes and missing or blank answers", async () => {
    for (const text of ["not json", "```json\nnot json\n```", ""]) {
      const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse(text)));
      await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
    }
    for (const payload of [
      { content: [] },
      { content: [{ type: "tool_use", text: "{}" }] },
      {},
    ]) {
      const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(response(payload)));
      await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-response-invalid" });
    }
    for (const invalid of [{}, { answer: "" }, { answer: "   " }, { ...structured, answer: undefined }]) {
      const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse(invalid)));
      await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-response-invalid" });
    }
  });

  it("rejects oversized arrays and unknown JSON fields instead of passing them through", async () => {
    const oversize = [
      { ...structured, suggestions: Array.from({ length: 4 }, () => ({ spanish: "Hola", chinese: "你好" })) },
      { ...structured, corrections: Array.from({ length: 9 }, () => ({ original: "a", corrected: "b", explanation: "c" })) },
      { ...structured, structure: Array.from({ length: 13 }, () => ({ fragment: "a", role: "主语", explanation: "b" })) },
      { ...structured, unexpected: "extra" },
      { ...structured, answer: "x".repeat(4_001) },
    ];
    for (const payload of oversize) {
      const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse(payload)));
      await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-response-invalid" });
    }
  });

  it.each([
    [401, "provider-auth-failed", false],
    [403, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [500, "provider-unavailable", true],
    [503, "provider-unavailable", true],
    [400, "provider-response-invalid", false],
  ] as const)("maps HTTP %s to %s without exposing provider data", async (status, code, retryable) => {
    const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response("private provider body", { status })));
    await expect(provider.assist(input)).rejects.toMatchObject({ code, retryable });
  });

  it("maps network failure to an unavailable provider", async () => {
    const { provider } = fixture(vi.fn<typeof fetch>().mockRejectedValue(new Error("private network details")));
    await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-unavailable", retryable: true });
  });

  it("refuses to call the provider without credentials", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = new MiniMaxConversationAssistantProvider({ apiKey: " ", fetchImplementation });
    await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-auth-failed", retryable: false });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("validates the internal input before any request", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const { provider } = fixture(fetchImplementation);
    const invalidInputs = [
      { ...input, intent: "translate" },
      { ...input, question: " " },
      { ...input, question: "x".repeat(801) },
      { ...input, targetText: "x".repeat(2_001) },
      { ...input, intent: "grammar", targetText: null },
      { ...input, intent: "question", question: null },
      { ...input, characterDisplayName: " " },
      { ...input, recentMessages: Array.from({ length: 9 }, () => ({ role: "user" as const, text: "Hola" })) },
      { ...input, recentMessages: [{ role: "user" as const, text: "x".repeat(2_001) }] },
      { ...input, recentMessages: [{ role: "system" as const, text: "Hola" }] },
    ];
    for (const invalid of invalidInputs) {
      await expect(provider.assist(invalid as ConversationAssistantProviderInput)).rejects.toMatchObject({
        code: "input-invalid",
        retryable: false,
      });
    }
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not start an already cancelled request", async () => {
    const { provider, fetchImplementation } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.assist(input, { signal: controller.signal })).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("cancels promptly even when fetch ignores abort", async () => {
    let resolveFetch!: (value: Response) => void;
    const { provider } = fixture(vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const controller = new AbortController();
    const result = provider.assist(input, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ code: "provider-cancelled", retryable: false });
    controller.abort();
    await assertion;
    resolveFetch(contentResponse());
  });

  it("ignores a response that arrives while the body is still being read", async () => {
    const incoming = contentResponse();
    vi.spyOn(incoming, "json").mockImplementation(() => new Promise(() => {}));
    const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(incoming));
    const controller = new AbortController();
    const result = provider.assist(input, { signal: controller.signal });
    const assertion = expect(result).rejects.toMatchObject({ code: "provider-cancelled" });
    controller.abort();
    await assertion;
  });

  it("times out even when the provider ignores abort", async () => {
    vi.useFakeTimers();
    const { provider } = fixture(vi.fn<typeof fetch>().mockImplementation(() => new Promise(() => {})), { timeoutMs: 50 });
    const result = provider.assist(input);
    const assertion = expect(result).rejects.toMatchObject({ code: "provider-timeout", retryable: true });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reads its configuration from the server environment", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-minimax-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "https://minimax.env.test/anthropic/v1/messages");
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(contentResponse());
    const provider = createMiniMaxConversationAssistantProvider({ fetchImplementation });
    await expect(provider.assist(input)).resolves.toMatchObject({ provider: "minimax" });
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe("https://minimax.env.test/anthropic/v1/messages");
    expect((fetchImplementation.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-api-key"]).toBe("env-minimax-key");

    vi.stubEnv("MINIMAX_API_KEY", "");
    const unconfigured = createMiniMaxConversationAssistantProvider({ fetchImplementation });
    await expect(unconfigured.assist(input)).rejects.toMatchObject({ code: "provider-auth-failed" });
  });
});
