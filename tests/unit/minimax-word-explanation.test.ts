import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MiniMaxWordExplanationProvider,
  createMiniMaxWordExplanationProvider,
} from "@/src/modules/providers/word-explanation/server";
import type { WordExplanationInput } from "@/src/modules/providers/word-explanation";

const input: WordExplanationInput = {
  word: "café",
  context: "Nos vemos en el café mañana.",
  locale: "es-ES",
};

const sentenceInput: WordExplanationInput = {
  word: "Después de clase, Marta entra en una cafetería.",
  context: "Después de clase, Marta entra en una cafetería.",
  locale: "es-ES",
  selectionType: "sentence",
};

function response(body: unknown, status = 200, headers: HeadersInit = { "x-request-id": "mmx-word-123" }): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function streamResponse(chunks: string[], headers: HeadersInit = { "x-request-id": "mmx-stream-123" }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

function successResponse() {
  return {
    content: [{ type: "text", text: JSON.stringify({
      partOfSpeech: "名词",
      meaning: "咖啡；也可以指喝咖啡的场所",
      contextualMeaning: "这里指见面的咖啡馆，而不是饮料本身。",
      example: "Nos vemos en el café mañana.",
    }) }],
  };
}

describe("MiniMaxWordExplanationProvider", () => {
  it("sends the word and sentence context without exposing secrets in the result", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response(successResponse());
    });
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const provider = new MiniMaxWordExplanationProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation,
      clock,
    });

    await expect(provider.explain(input)).resolves.toMatchObject({
      partOfSpeech: "名词",
      contextualMeaning: "这里指见面的咖啡馆，而不是饮料本身。",
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "mmx-word-123",
      latencyMs: 42,
    });
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
    expect(request?.method).toBe("POST");
    expect((request?.headers as Record<string, string>)["x-api-key"]).toBe("test-minimax-key");
    expect(body.model).toBe("MiniMax-M3");
    expect(JSON.stringify(body)).toContain(input.word);
    expect(JSON.stringify(body)).toContain(input.context);
  });

  it("rejects missing configuration and malformed output", async () => {
    const noKey = new MiniMaxWordExplanationProvider({ apiKey: " ", fetchImplementation: vi.fn() });
    await expect(noKey.explain(input)).rejects.toMatchObject({ code: "provider-auth-failed", retryable: false });

    const malformed = new MiniMaxWordExplanationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ content: [{ type: "text", text: "not json" }] })),
    });
    await expect(malformed.explain(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });

  it("marks sentence selections in the prompt", async () => {
    let request: RequestInit | undefined;
    const provider = new MiniMaxWordExplanationProvider({
      apiKey: "test-minimax-key",
      endpoint: "https://minimax.test/anthropic/v1/messages",
      fetchImplementation: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        request = init;
        return response(successResponse());
      }),
    });

    await provider.explain(sentenceInput);
    const body = JSON.parse(String(request?.body)) as { messages?: Array<{ content?: Array<{ text?: string }> }> };
    const prompt = body.messages?.[0]?.content?.[0]?.text ?? "";
    expect(prompt).toContain('"selectionType":"sentence"');
    expect(prompt).toContain('"task":"explain_sentence"');
  });

  it("streams MiniMax deltas and validates the final explanation", async () => {
    let request: RequestInit | undefined;
    const json = JSON.stringify({
      partOfSpeech: "名词",
      meaning: "咖啡",
      contextualMeaning: "这里指咖啡馆。",
      example: "Nos vemos en el café.",
    });
    const provider = new MiniMaxWordExplanationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        request = init;
        return streamResponse([
          `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: json.slice(0, 28) } })}\n\n`,
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: json.slice(28) } })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }),
    });

    const events = [];
    for await (const event of provider.explainStream(input)) events.push(event);
    expect((JSON.parse(String(request?.body)) as { stream?: boolean }).stream).toBe(true);
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toBe(json);
    expect(events.at(-1)).toMatchObject({ type: "done", explanation: { meaning: "咖啡", provider: "minimax" } });
  });

  it("rejects malformed streams after collecting deltas", async () => {
    const provider = new MiniMaxWordExplanationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => streamResponse(["data: {\"delta\":{\"text\":\"not-json\"}}\n\n"])),
    });
    const consume = async () => {
      for await (const event of provider.explainStream(input)) void event;
    };
    await expect(consume()).rejects.toMatchObject({ code: "provider-response-invalid" });
  });

  it("maps timeout and caller cancellation for streaming requests", async () => {
    const pendingFetch = (signal?: AbortSignal) => new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const timeoutProvider = new MiniMaxWordExplanationProvider({ apiKey: "test-key", timeoutMs: 5, fetchImplementation: (_url, init) => pendingFetch(init?.signal ?? undefined) });
    const consumeTimeout = async () => { for await (const event of timeoutProvider.explainStream(input)) void event; };
    await expect(consumeTimeout()).rejects.toMatchObject({ code: "provider-timeout" });

    const caller = new AbortController();
    const cancelledProvider = new MiniMaxWordExplanationProvider({ apiKey: "test-key", timeoutMs: 1000, fetchImplementation: (_url, init) => pendingFetch(init?.signal ?? undefined) });
    const consumeCancelled = async () => { for await (const event of cancelledProvider.explainStream(input, { signal: caller.signal })) void event; };
    const promise = consumeCancelled();
    caller.abort();
    await expect(promise).rejects.toMatchObject({ code: "provider-cancelled" });
  });

  it.each([
    [401, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const provider = new MiniMaxWordExplanationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () => response({ error: "provider secret" }, status)),
    });
    await expect(provider.explain(input)).rejects.toMatchObject({ code, retryable });
  });

  it("loads endpoint and key from the server environment through its factory", async () => {
    vi.stubEnv("MINIMAX_API_KEY", "env-key");
    vi.stubEnv("MINIMAX_API_ENDPOINT", "https://env.test/messages");
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
      void _url;
      void _init;
      return response(successResponse());
    });
    const provider = createMiniMaxWordExplanationProvider({ fetchImplementation });
    await provider.explain(input);
    const firstCall = fetchImplementation.mock.calls[0] as [RequestInfo | URL, RequestInit] | undefined;
    expect(firstCall?.[0]).toBe("https://env.test/messages");
    expect((firstCall?.[1]?.headers as Record<string, string>)["x-api-key"]).toBe("env-key");
    vi.unstubAllEnvs();
  });
});
