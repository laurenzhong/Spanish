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
  senseGroups: [],
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
  it("uses M3.1 thinking without exposing it in the structured answer", async () => {
    const { provider, fetchImplementation } = fixture(vi.fn<typeof fetch>().mockResolvedValue(response({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "PRIVATE_REASONING", signature: "test-signature" },
        { type: "text", text: JSON.stringify(structured) },
      ],
    })), { modelVersion: undefined });
    const result = await provider.assist(input);
    expect(result.answer).toBe(structured.answer);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_REASONING");
    const body = requestBody(fetchImplementation);
    expect(body).toMatchObject({ model: "MiniMax-M3.1-Flash", output_config: { effort: "low" }, max_tokens: 6_596 });
    expect(body).not.toHaveProperty("thinking");
  });

  it("rejects a truncated response even when it contains valid JSON", async () => {
    const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(response({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: JSON.stringify(structured) }],
    })));
    await expect(provider.assist(input)).rejects.toMatchObject({ code: "provider-response-invalid" });
  });

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
      max_tokens: 2_500,
      // Stable role wording across repeated analyses of the same sentence.
      temperature: 0.2,
      thinking: { type: "disabled" },
      stream: false,
      messages: [{ role: "user" }],
    });
    const system = String(body.system);
    expect(system).toContain("Simplified Chinese");
    expect(system).toContain("es-ES");
    expect(system).toContain("JSON object");
    expect(system).toContain("senseGroups");
    expect(system).toContain("Never invent facts");
    expect(system).toContain("untrusted conversation data");
    expect(promptPayload(fetchImplementation)).toEqual({
      intent: "reply",
      question: input.question,
      targetText: null,
      senseGroupCount: 0,
      senseGroups: [],
      characterDisplayName: "Lucía Martín",
      recentMessages: input.recentMessages,
    });
  });

  it.each([
    ["reply", { question: "怎么礼貌地答应？", targetText: null }],
    ["grammar", { question: null, targetText: "Yo soy cansado." }],
    ["structure", { question: null, targetText: "Lucía compró flores ayer.", senseGroups: ["Lucía compró flores ayer"] }],
    ["question", { question: "querer 和 amar 有什么区别？", targetText: null }],
  ] as const)("answers the %s intent with a validated JSON payload", async (intent, patch) => {
    const annotations = [{ index: 1, role: "陈述句", explanation: "“Lucía”是主语，“compró”是谓语。" }];
    const { provider, fetchImplementation } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(
        contentResponse(intent === "structure" ? { ...structured, structure: annotations } : structured),
      ),
    );
    const result = await provider.assist({ ...input, intent, ...patch });
    expect(result.answer).toBe(structured.answer);
    if (intent === "structure") {
      expect(result.structure).toEqual([
        { fragment: "Lucía compró flores ayer", role: "陈述句", explanation: "“Lucía”是主语，“compró”是谓语。" },
      ]);
    }
    const payload = promptPayload(fetchImplementation);
    expect(payload).toMatchObject({ intent, question: patch.question, targetText: patch.targetText });
    if (intent === "structure") {
      expect(payload.senseGroupCount).toBe(1);
      expect(payload.senseGroups).toEqual([{ index: 1, fragment: "Lucía compró flores ayer" }]);
    }
  });

  it("annotates the application's deterministic sense groups without re-splitting them", async () => {
    const senseGroups = ["Perfecto", "entonces", "ya estás en la empresa"] as const;
    const annotations = [
      { index: 1, role: "感叹词", explanation: "表示认可或满意，承接对方说已经去公司上班了。" },
      { index: 2, role: "连接词", explanation: "表示“那么”，把前面的信息与当前话题连接起来。" },
      { index: 3, role: "陈述句", explanation: "“tú”是省略的主语，“estás”是谓语动词，“en la empresa”是地点状语。" },
    ];
    const { provider, fetchImplementation } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(contentResponse({ ...structured, structure: annotations })),
    );

    const result = await provider.assist({
      ...input,
      intent: "structure",
      question: null,
      targetText: "Perfecto, entonces ya estás en la empresa.",
      senseGroups,
    });

    expect(result.structure).toEqual([
      { fragment: "Perfecto", role: annotations[0].role, explanation: annotations[0].explanation },
      { fragment: "entonces", role: annotations[1].role, explanation: annotations[1].explanation },
      { fragment: "ya estás en la empresa", role: annotations[2].role, explanation: annotations[2].explanation },
    ]);
    expect(promptPayload(fetchImplementation)).toMatchObject({
      intent: "structure",
      targetText: "Perfecto, entonces ya estás en la empresa.",
      senseGroupCount: 3,
      senseGroups: [
        { index: 1, fragment: "Perfecto" },
        { index: 2, fragment: "entonces" },
        { index: 3, fragment: "ya estás en la empresa" },
      ],
    });
  });

  it("keeps the deterministic fragment even when the model repeats its own fragment", async () => {
    const { provider } = fixture(
      vi.fn<typeof fetch>().mockResolvedValue(
        contentResponse({
          ...structured,
          structure: [
            { index: 1, fragment: "Perfecto, entonces", role: "表达", explanation: "第一部分。" },
            { index: 2, fragment: "ya estás", role: "陈述句", explanation: "第二部分。" },
          ],
        }),
      ),
    );

    const result = await provider.assist({
      ...input,
      intent: "structure",
      question: null,
      targetText: "Perfecto, entonces ya estás en la empresa.",
      senseGroups: ["Perfecto, entonces", "ya estás en la empresa"],
    });

    expect(result.structure.map((part) => part.fragment)).toEqual(["Perfecto, entonces", "ya estás en la empresa"]);
  });

  it("fails closed when the model does not annotate every sense group exactly once", async () => {
    for (const structure of [
      [],
      [{ index: 1, role: "感叹词", explanation: "表示认可。" }],
      [{ index: 1, role: "感叹词", explanation: "a" }, { index: 2, role: "连接词", explanation: "b" }],
      [
        { index: 1, role: "感叹词", explanation: "a" },
        { index: 2, role: "连接词", explanation: "b" },
        { index: 2, role: "陈述句", explanation: "重复索引。" },
      ],
      [
        { index: 1, role: "感叹词", explanation: "a" },
        { index: 2, role: "连接词", explanation: "b" },
        { index: 4, role: "陈述句", explanation: "跳过了第三个意群。" },
      ],
    ]) {
      const { provider } = fixture(vi.fn<typeof fetch>().mockResolvedValue(contentResponse({ ...structured, structure })));
      await expect(provider.assist({
        ...input,
        intent: "structure",
        question: null,
        targetText: "Perfecto, entonces ya estás en la empresa.",
        senseGroups: ["Perfecto", "entonces", "ya estás en la empresa"],
      })).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
    }
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
      { ...structured, structure: Array.from({ length: 13 }, (_, index) => ({ index: index + 1, role: "陈述句", explanation: "b" })) },
      { ...structured, structure: [{ role: "陈述句", explanation: "缺少 index。" }] },
      { ...structured, structure: [{ index: 1, role: "陈述句", explanation: "b", unexpected: "extra" }] },
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
      { ...input, senseGroups: ["Hola"] },
      { ...input, intent: "structure", targetText: "Hola.", senseGroups: [] },
      { ...input, intent: "structure", targetText: "Hola.", senseGroups: [" "] },
      { ...input, intent: "structure", targetText: "Hola.", senseGroups: ["x".repeat(2_001)] },
      { ...input, intent: "structure", targetText: null, senseGroups: ["Hola"] },
      { ...input, intent: "structure", targetText: "Hola.", senseGroups: Array.from({ length: 13 }, () => "Hola") },
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
