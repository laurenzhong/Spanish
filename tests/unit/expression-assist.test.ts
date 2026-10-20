// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { assistExpression, ExpressionAssistError } from "@/src/modules/conversation/application/assist-expression";
import { conversationCharacterVersion } from "@/src/modules/conversation/domain/character-catalog";
import { TranslationError, type TranslationResult } from "@/src/modules/providers/translation/translation";

const result: TranslationResult = { text: "¿Quedamos otro día?", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null };
const input = { userId: "owner", characterKey: "lucia", characterVersion: conversationCharacterVersion("lucia")!, text: "改天再约", attemptId: "attempt-1" };
function dependencies() {
  return {
    repository: { getCurrentPublishedVersion: vi.fn().mockResolvedValue(input.characterVersion), listContext: vi.fn().mockResolvedValue([{ role: "assistant", text: "¿Te vienes hoy?" }]) },
    getContactStatus: vi.fn().mockResolvedValue("active"),
    provider: { translate: vi.fn().mockResolvedValue(result) },
    onProviderResult: vi.fn(),
  };
}
afterEach(() => vi.useRealTimers());

describe("private expression assistance", () => {
  it("reads only this user's character context and returns only an editable expression", async () => {
    const deps = dependencies();
    expect(await assistExpression(input, deps)).toEqual({ text: result.text, attemptId: input.attemptId });
    expect(deps.repository.listContext).toHaveBeenCalledWith("owner", "lucia");
    expect(deps.provider.translate).toHaveBeenCalledWith({ text: input.text, sourceLocale: "zh-CN", targetLocale: "es-ES", context: [{ role: "assistant", text: "¿Te vienes hoy?" }] }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(deps.onProviderResult).toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded", provider: "fake", modelVersion: "fake-v1" }));
    expect(JSON.stringify(deps.onProviderResult.mock.calls)).not.toContain(input.text);
    expect(JSON.stringify(deps.onProviderResult.mock.calls)).not.toContain(result.text);
  });
  it.each(["pending", "declined", "unavailable"])("blocks %s contacts before context or provider reads", async (status) => {
    const deps = dependencies(); deps.getContactStatus.mockResolvedValue(status);
    await expect(assistExpression(input, deps)).rejects.toMatchObject({ code: status === "unavailable" ? "CONTACT_UNAVAILABLE" : "CONTACT_REQUIRED" });
    expect(deps.provider.translate).not.toHaveBeenCalled(); expect(deps.repository.listContext).not.toHaveBeenCalled();
  });
  it("rejects current revision mismatch and unreleased characters", async () => {
    const deps = dependencies(); deps.repository.getCurrentPublishedVersion.mockResolvedValue(input.characterVersion + 1);
    await expect(assistExpression(input, deps)).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });
    await expect(assistExpression({ ...input, characterKey: "mateo" }, dependencies())).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });
    expect(deps.provider.translate).not.toHaveBeenCalled();
  });
  it("fails closed on context failure", async () => {
    const deps = dependencies(); deps.repository.listContext.mockRejectedValue(new Error("private database failure"));
    await expect(assistExpression(input, deps)).rejects.toMatchObject({ code: "CONVERSATION_UNAVAILABLE" });
    expect(deps.provider.translate).not.toHaveBeenCalled();
  });
  it.each(["", "a".repeat(2001), "这是中文结果", "Hola 你好"])("rejects invalid or non-Spanish provider output", async (text) => {
    const deps = dependencies(); deps.provider.translate.mockResolvedValue({ ...result, text });
    await expect(assistExpression(input, deps)).rejects.toBeInstanceOf(TranslationError);
  });
  it("caps even a buggy repository's context to six 2000-character messages", async () => {
    const deps = dependencies(); deps.repository.listContext.mockResolvedValue(Array.from({ length: 9 }, (_, n) => ({ role: "user", text: `${n}${"x".repeat(3000)}` })));
    await assistExpression(input, deps);
    const context = deps.provider.translate.mock.calls[0]?.[0]?.context;
    expect(context).toHaveLength(6); expect(context?.[0].text[0]).toBe("3"); expect(context?.every((message: {text:string}) => message.text.length <= 2000)).toBe(true);
  });
  it("cancels promptly and ignores a provider that completes after cancellation", async () => {
    const deps = dependencies(); const controller = new AbortController();
    let finish!: (value: TranslationResult) => void;
    deps.provider.translate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = assistExpression(input, { ...deps, signal: controller.signal });
    await vi.waitFor(() => expect(deps.provider.translate).toHaveBeenCalled());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "provider-cancelled" });
    finish(result); await Promise.resolve();
    expect(deps.onProviderResult).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });
  it("times out after 30 seconds even when the provider ignores abort", async () => {
    vi.useFakeTimers(); const deps = dependencies(); deps.provider.translate.mockImplementation(() => new Promise(() => {}));
    const pending = assistExpression(input, deps); const assertion = expect(pending).rejects.toMatchObject({ code: "provider-timeout" });
    await vi.advanceTimersByTimeAsync(30_000); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not start the provider for an already cancelled request", async () => {
    const deps = dependencies(); const controller = new AbortController(); controller.abort();
    await expect(assistExpression(input, { ...deps, signal: controller.signal })).rejects.toMatchObject({ code: "provider-cancelled" });
    expect(deps.provider.translate).not.toHaveBeenCalled();
    expect(ExpressionAssistError).toBeDefined();
  });
  it("keeps success and failure independent of throwing or stalled metadata observers", async () => {
    const deps = dependencies();
    deps.onProviderResult.mockImplementation(() => { throw new Error("observer unavailable"); });
    expect(await assistExpression(input, deps)).toEqual({ text: result.text, attemptId: input.attemptId });
    deps.onProviderResult.mockImplementation(() => new Promise(() => {}));
    expect(await assistExpression(input, deps)).toEqual({ text: result.text, attemptId: input.attemptId });
    deps.provider.translate.mockRejectedValueOnce(new TranslationError("provider-rate-limited", "private provider error", true));
    await expect(assistExpression(input, deps)).rejects.toMatchObject({ code: "provider-rate-limited" });
  });
});
