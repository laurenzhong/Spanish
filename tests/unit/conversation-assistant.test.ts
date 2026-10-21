// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consultConversationAssistant,
  ConversationAssistantError,
  type ConsultConversationAssistantDependencies,
} from "@/src/modules/conversation/application/consult-conversation-assistant";
import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";
import {
  ConversationAssistantProviderError,
  type ConversationAssistantProviderResult,
} from "@/src/modules/providers/assistant/assistant";

const version = conversationCharacterVersion("lucia")!;
const context = [
  { role: "user" as const, text: "Hola, Lucía" },
  { role: "assistant" as const, text: "¿Te vienes a cenar el sábado?" },
];
const providerResult: ConversationAssistantProviderResult = {
  answer: "可以委婉拒绝，同时保持友好。",
  suggestions: [{ spanish: "Me encantaría, pero el sábado ya tengo planes.", chinese: "我很想去，但周六已经有安排了。" }],
  corrections: [],
  structure: [],
  correctedSentence: null,
  provider: "fake",
  modelVersion: "fake-v1",
  providerRequestId: null,
  latencyMs: 1,
  estimatedCostMicros: null,
};

const input = {
  userId: "owner",
  characterKey: "lucia",
  intent: "reply",
  characterVersion: version,
  attemptId: "attempt-1",
  question: "想拒绝她的邀请，怎么回？",
};

function dependencies() {
  return {
    repository: {
      getCurrentPublishedVersion: vi.fn().mockResolvedValue(version),
      listContext: vi.fn().mockResolvedValue(context),
    },
    getContactStatus: vi.fn().mockResolvedValue("active"),
    provider: { assist: vi.fn().mockResolvedValue(providerResult) },
    onProviderResult: vi.fn(),
  };
}

async function sameError(promise: Promise<unknown>, code: string, status: number) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ConversationAssistantError);
  expect(error).toMatchObject({ code, status });
  return error as ConversationAssistantError;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("private conversation assistant use case", () => {
  it("reads only this user's character context and returns a normalized transient answer", async () => {
    const deps = dependencies();
    const result = await consultConversationAssistant(input, deps);

    expect(result).toEqual({
      attemptId: input.attemptId,
      intent: "reply",
      answer: providerResult.answer,
      suggestions: providerResult.suggestions,
      corrections: [],
      structure: [],
      correctedSentence: null,
    });
    expect(deps.repository.getCurrentPublishedVersion).toHaveBeenCalledWith("lucia");
    expect(deps.repository.listContext).toHaveBeenCalledWith("owner", "lucia");
    expect(deps.provider.assist).toHaveBeenCalledWith({
      intent: "reply",
      question: input.question,
      targetText: null,
      characterDisplayName: "Lucía Martín",
      recentMessages: context,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(deps.onProviderResult).toHaveBeenCalledWith({
      provider: "fake",
      modelVersion: "fake-v1",
      providerRequestId: null,
      latencyMs: 1,
      estimatedCostMicros: null,
      status: "succeeded",
    });
    const observed = JSON.stringify(deps.onProviderResult.mock.calls);
    expect(observed).not.toContain(input.question);
    expect(observed).not.toContain("Me encantaría");
    expect(observed).not.toContain("可以委婉拒绝");
  });

  it("rejects invalid requests before reading anything", async () => {
    for (const invalid of [
      { ...input, intent: "translate" },
      { ...input, intent: "" },
      { ...input, characterVersion: 0 },
      { ...input, characterVersion: 1.5 },
      { ...input, attemptId: " " },
      { ...input, question: "x".repeat(801) },
      { ...input, targetText: "x".repeat(2_001) },
      { ...input, intent: "question", question: undefined },
      { ...input, intent: "grammar", targetText: undefined },
    ]) {
      const deps = dependencies();
      await sameError(consultConversationAssistant(invalid, deps), "VALIDATION_FAILED", 400);
      expect(deps.repository.getCurrentPublishedVersion).not.toHaveBeenCalled();
      expect(deps.provider.assist).not.toHaveBeenCalled();
    }
  });

  it("rejects unknown, stale and unreleased characters", async () => {
    const unavailable = dependencies();
    await sameError(consultConversationAssistant({ ...input, characterKey: "unknown" }, unavailable), "CHARACTER_UNAVAILABLE", 404);
    await sameError(consultConversationAssistant({ ...input, characterVersion: version + 1 }, unavailable), "CHARACTER_UNAVAILABLE", 404);
    await sameError(consultConversationAssistant({ ...input, characterKey: "mateo", characterVersion: conversationCharacterVersion("mateo")! }, unavailable), "CHARACTER_UNAVAILABLE", 404);
    expect(unavailable.provider.assist).not.toHaveBeenCalled();
  });

  it("rejects a character whose current published version moved on", async () => {
    const deps = dependencies();
    deps.repository.getCurrentPublishedVersion.mockResolvedValue(version + 1);
    await sameError(consultConversationAssistant(input, deps), "CHARACTER_UNAVAILABLE", 404);
    expect(deps.repository.listContext).not.toHaveBeenCalled();
    expect(deps.provider.assist).not.toHaveBeenCalled();

    const missing = dependencies();
    missing.repository.getCurrentPublishedVersion.mockResolvedValue(null);
    await sameError(consultConversationAssistant(input, missing), "CHARACTER_UNAVAILABLE", 404);
  });

  it("requires persistence unless the explicit non-production fallback gate is open", async () => {
    const unmarked = dependencies();
    delete (unmarked as { repository?: unknown }).repository;
    await sameError(consultConversationAssistant(input, unmarked as unknown as ConsultConversationAssistantDependencies), "CONVERSATION_UNAVAILABLE", 503);
    expect(unmarked.provider.assist).not.toHaveBeenCalled();

    const production = dependencies();
    delete (production as { repository?: unknown }).repository;
    vi.stubEnv("NODE_ENV", "production");
    await sameError(consultConversationAssistant(input, { ...(production as unknown as ConsultConversationAssistantDependencies), allowStaticFallback: true }), "CONVERSATION_UNAVAILABLE", 503);
    expect(production.provider.assist).not.toHaveBeenCalled();

    vi.stubEnv("NODE_ENV", "test");
    const fallback = dependencies();
    delete (fallback as { repository?: unknown }).repository;
    expect(await consultConversationAssistant({ ...input, intent: "reply", question: "怎么回？" }, { ...(fallback as unknown as ConsultConversationAssistantDependencies), allowStaticFallback: true })).toMatchObject({ attemptId: input.attemptId });
    expect(fallback.provider.assist.mock.calls[0]?.[0].recentMessages).toEqual([]);
  });

  it("fails closed when the published version cannot be read", async () => {
    const deps = dependencies();
    deps.repository.getCurrentPublishedVersion.mockRejectedValue(new Error("private database failure"));
    const error = await sameError(consultConversationAssistant(input, deps), "CONVERSATION_UNAVAILABLE", 503);
    expect(error.message).not.toContain("private database failure");
    expect(deps.provider.assist).not.toHaveBeenCalled();
  });

  it("blocks non-active contacts before reading context or calling the provider", async () => {
    for (const status of ["pending", "declined"]) {
      const deps = dependencies();
      deps.getContactStatus.mockResolvedValue(status);
      await sameError(consultConversationAssistant(input, deps), "CONTACT_REQUIRED", 403);
      expect(deps.repository.listContext).not.toHaveBeenCalled();
      expect(deps.provider.assist).not.toHaveBeenCalled();
    }
    const unavailable = dependencies();
    unavailable.getContactStatus.mockResolvedValue("unavailable");
    await sameError(consultConversationAssistant(input, unavailable), "CONTACT_UNAVAILABLE", 503);
    const failing = dependencies();
    failing.getContactStatus.mockRejectedValue(new Error("private contact failure"));
    await sameError(consultConversationAssistant(input, failing), "CONTACT_UNAVAILABLE", 503);
    expect(failing.provider.assist).not.toHaveBeenCalled();
  });

  it("fails closed when the conversation context cannot be read", async () => {
    const deps = dependencies();
    deps.repository.listContext.mockRejectedValue(new Error("private database failure"));
    const error = await sameError(consultConversationAssistant(input, deps), "CONVERSATION_UNAVAILABLE", 503);
    expect(error.message).not.toContain("private database failure");
    expect(deps.provider.assist).not.toHaveBeenCalled();
  });

  it("bounds a buggy context to eight non-blank messages of 2000 characters", async () => {
    const deps = dependencies();
    deps.repository.listContext.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `${index}:${"x".repeat(3_000)}`,
    })));
    await consultConversationAssistant(input, deps);
    const recent = (deps.provider.assist.mock.calls[0]?.[0] as { recentMessages: Array<{ text: string }> }).recentMessages;
    expect(recent).toHaveLength(8);
    expect(recent[0]?.text.startsWith("2:")).toBe(true);
    expect(recent.every((message) => message.text.length <= 2_000)).toBe(true);

    const blank = dependencies();
    blank.repository.listContext.mockResolvedValue([
      { role: "user" as const, text: "Hola" },
      { role: "assistant" as const, text: "   " },
      { role: "assistant" as const, text: "¿Nos vemos?" },
    ]);
    await consultConversationAssistant(input, blank);
    expect((blank.provider.assist.mock.calls[0]?.[0] as { recentMessages: unknown[] }).recentMessages).toEqual([
      { role: "user", text: "Hola" },
      { role: "assistant", text: "¿Nos vemos?" },
    ]);
  });

  it("falls back to the last character sentence for structure analysis", async () => {
    const deps = dependencies();
    deps.repository.listContext.mockResolvedValue(context);
    await consultConversationAssistant({ ...input, intent: "structure", question: undefined }, deps);
    expect((deps.provider.assist.mock.calls[0]?.[0] as { targetText: string }).targetText).toBe("¿Te vienes a cenar el sábado?");

    const explicit = dependencies();
    await consultConversationAssistant({ ...input, intent: "structure", question: undefined, targetText: "  Lucía compró flores ayer.  " }, explicit);
    expect((explicit.provider.assist.mock.calls[0]?.[0] as { targetText: string }).targetText).toBe("Lucía compró flores ayer.");
  });

  it("returns a validation error when there is no sentence to analyse", async () => {
    const deps = dependencies();
    deps.repository.listContext.mockResolvedValue([{ role: "user" as const, text: "Hola" }]);
    const error = await sameError(
      consultConversationAssistant({ ...input, intent: "structure", question: undefined }, deps),
      "VALIDATION_FAILED",
      400,
    );
    expect(error.reason).toBe("no-target-sentence");
    expect(deps.provider.assist).not.toHaveBeenCalled();
  });

  it("passes a trimmed grammar target and a question-only input to the provider", async () => {
    const grammar = dependencies();
    await consultConversationAssistant({ ...input, intent: "grammar", question: undefined, targetText: "  Yo soy cansado.  " }, grammar);
    expect(grammar.provider.assist.mock.calls[0]?.[0]).toMatchObject({ intent: "grammar", question: null, targetText: "Yo soy cansado." });

    const question = dependencies();
    await consultConversationAssistant({ ...input, intent: "question" }, question);
    expect(question.provider.assist.mock.calls[0]?.[0]).toMatchObject({ intent: "question", question: input.question, targetText: null });
  });

  it("propagates provider errors and records a content-free failed observation", async () => {
    for (const code of ["provider-rate-limited", "provider-timeout", "provider-auth-failed", "provider-unavailable", "provider-response-invalid", "provider-cancelled"] as const) {
      const deps = dependencies();
      deps.provider.assist.mockRejectedValue(new ConversationAssistantProviderError(code, "private provider body", false));
      const error = await consultConversationAssistant(input, deps).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ConversationAssistantProviderError);
      expect(error).toMatchObject({ code });
      expect(deps.onProviderResult).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorType: code }));
      const observed = JSON.stringify(deps.onProviderResult.mock.calls);
      expect(observed).not.toContain("private provider body");
      expect(observed).not.toContain(input.question);
    }
  });

  it("rejects a provider result that does not satisfy the response DTO", async () => {
    const deps = dependencies();
    deps.provider.assist.mockResolvedValue({ ...providerResult, answer: " " });
    const error = await consultConversationAssistant(input, deps).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "provider-response-invalid" });
    expect(deps.onProviderResult).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", errorType: "provider-response-invalid" }));
    expect(deps.onProviderResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));

    const oversize = dependencies();
    oversize.provider.assist.mockResolvedValue({ ...providerResult, suggestions: Array.from({ length: 4 }, () => ({ spanish: "Hola", chinese: "你好" })) });
    expect(await consultConversationAssistant(input, oversize).catch((caught: unknown) => caught)).toMatchObject({ code: "provider-response-invalid" });

    const empty = dependencies();
    empty.provider.assist.mockResolvedValue({ ...providerResult, correctedSentence: "" });
    await expect(consultConversationAssistant(input, empty)).resolves.toMatchObject({ correctedSentence: null });
  });

  it("cancels promptly and ignores a provider that completes after cancellation", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    let finish!: (value: ConversationAssistantProviderResult) => void;
    deps.provider.assist.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = consultConversationAssistant(input, { ...deps, signal: controller.signal });
    await vi.waitFor(() => expect(deps.provider.assist).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "provider-cancelled" });
    finish(providerResult);
    await Promise.resolve();
    expect(deps.onProviderResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });

  it("does not call the provider for an already cancelled request", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();
    await expect(consultConversationAssistant(input, { ...deps, signal: controller.signal })).rejects.toMatchObject({ code: "provider-cancelled" });
    expect(deps.provider.assist).not.toHaveBeenCalled();
  });

  it("times out after 30 seconds even when the provider ignores abort", async () => {
    vi.useFakeTimers();
    const deps = dependencies();
    deps.provider.assist.mockImplementation(() => new Promise(() => {}));
    const pending = consultConversationAssistant(input, deps);
    const assertion = expect(pending).rejects.toMatchObject({ code: "provider-timeout" });
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
    // The fake provider never settles, so no completion observation is due:
    // the request fails closed even though the provider ignores abort.
  });

  it("keeps success independent of throwing or stalled metadata observers", async () => {
    const deps = dependencies();
    deps.onProviderResult.mockImplementation(() => { throw new Error("observer unavailable"); });
    await expect(consultConversationAssistant(input, deps)).resolves.toMatchObject({ answer: providerResult.answer });
    deps.onProviderResult.mockImplementation(() => new Promise(() => {}));
    await expect(consultConversationAssistant(input, deps)).resolves.toMatchObject({ answer: providerResult.answer });
  });

  it("exposes only read ports and a metadata observer", async () => {
    const deps = dependencies();
    expect(Object.keys(deps).sort()).toEqual(["getContactStatus", "onProviderResult", "provider", "repository"]);
    expect(Object.keys(deps.repository).sort()).toEqual(["getCurrentPublishedVersion", "listContext"]);
  });
});
