// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpressionAssistAttempts } from "@/src/modules/conversation/application/expression-assist-attempts";
import type { TranslationResult } from "@/src/modules/providers/translation/translation";

const input = { userId: "owner", characterKey: "lucia", characterVersion: 2, attemptId: "attempt-1", text: "今天有点累" };
const result: TranslationResult = { text: "Hoy estoy cansado.", provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null };
afterEach(() => vi.useRealTimers());
function deferred() {
  let resolve!: (result: TranslationResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TranslationResult>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
describe("private expression attempt reuse", () => {
  it("singleflights concurrent duplicate attempts and briefly reuses success", async () => {
    const attempts = new ExpressionAssistAttempts(); const pending = deferred(); const produce = vi.fn(() => pending.promise);
    const first = attempts.run(input, produce); const second = attempts.run(input, produce);
    await Promise.resolve(); expect(produce).toHaveBeenCalledTimes(1);
    pending.resolve(result); expect(await first).toEqual(result); expect(await second).toEqual(result);
    expect(await attempts.run(input, produce)).toEqual(result); expect(produce).toHaveBeenCalledTimes(1);
  });
  it("isolates users, characters, revisions and attempt IDs", async () => {
    const attempts = new ExpressionAssistAttempts(); const produce = vi.fn().mockResolvedValue(result);
    for (const variant of [input, { ...input, userId: "another-owner" }, { ...input, characterKey: "ines" }, { ...input, characterVersion: 3 }, { ...input, attemptId: "attempt-2" }]) await attempts.run(variant, produce);
    expect(produce).toHaveBeenCalledTimes(5);
  });
  it("refuses changed text under one attempt without a second provider call", async () => {
    const attempts = new ExpressionAssistAttempts(); const produce = vi.fn().mockResolvedValue(result);
    await attempts.run(input, produce);
    await expect(attempts.run({ ...input, text: "different" }, produce)).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(produce).toHaveBeenCalledTimes(1);
  });
  it("cancels one waiter without affecting another and cancels the last pending waiter", async () => {
    const attempts = new ExpressionAssistAttempts(); const pending = deferred(); let providerSignal!: AbortSignal;
    const produce = vi.fn((signal: AbortSignal) => { providerSignal = signal; return pending.promise; });
    const firstController = new AbortController(); const secondController = new AbortController();
    const first = attempts.run(input, produce, firstController.signal); const second = attempts.run(input, produce, secondController.signal);
    await Promise.resolve(); firstController.abort();
    await expect(first).rejects.toMatchObject({ code: "provider-cancelled" }); expect(providerSignal.aborted).toBe(false);
    pending.resolve(result); expect(await second).toEqual(result);
    const other = deferred(); const lastController = new AbortController();
    const last = attempts.run({ ...input, attemptId: "last" }, (signal) => { providerSignal = signal; return other.promise; }, lastController.signal);
    await Promise.resolve(); lastController.abort();
    await expect(last).rejects.toMatchObject({ code: "provider-cancelled" }); expect(providerSignal.aborted).toBe(true);
    other.resolve(result); await Promise.resolve();
    const retry = vi.fn().mockResolvedValue(result); await attempts.run({ ...input, attemptId: "last" }, retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
  it("removes provider failures for manual retry", async () => {
    const attempts = new ExpressionAssistAttempts(); const produce = vi.fn().mockRejectedValueOnce(new Error("provider failed")).mockResolvedValue(result);
    await expect(attempts.run(input, produce)).rejects.toThrow("provider failed");
    expect(await attempts.run(input, produce)).toEqual(result); expect(produce).toHaveBeenCalledTimes(2);
  });
  it("expires success after 30 seconds and clears all timers", async () => {
    vi.useFakeTimers(); const attempts = new ExpressionAssistAttempts(); const produce = vi.fn().mockResolvedValue(result);
    await attempts.run(input, produce); await vi.advanceTimersByTimeAsync(29_999);
    await attempts.run(input, produce); expect(produce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(vi.getTimerCount()).toBe(0);
    await attempts.run(input, produce); expect(produce).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000); expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds entries, evicts completed attempts and refuses a full pending registry", async () => {
    const attempts = new ExpressionAssistAttempts({ maxEntries: 1, maxBytes: 1000, ttlMs: 30_000 }); const produce = vi.fn().mockResolvedValue(result);
    await attempts.run(input, produce); await attempts.run({ ...input, attemptId: "two" }, produce); await attempts.run(input, produce);
    expect(produce).toHaveBeenCalledTimes(3);
    const pending = deferred(); const first = attempts.run({ ...input, attemptId: "pending" }, () => pending.promise);
    await expect(attempts.run({ ...input, attemptId: "full" }, produce)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    pending.resolve(result); await first;
  });
  it("evicts successful output by private byte budget", async () => {
    const attempts = new ExpressionAssistAttempts({ maxEntries: 128, maxBytes: 25, ttlMs: 30_000 }); const produce = vi.fn().mockResolvedValue(result);
    await attempts.run(input, produce); await attempts.run({ ...input, attemptId: "two" }, produce); await attempts.run(input, produce);
    expect(produce).toHaveBeenCalledTimes(3);
  });
  it("times out an uncooperative provider and frees the attempt", async () => {
    vi.useFakeTimers(); const attempts = new ExpressionAssistAttempts(); const pending = deferred();
    const first = attempts.run(input, () => pending.promise); const assertion = expect(first).rejects.toMatchObject({ code: "provider-timeout" });
    await vi.advanceTimersByTimeAsync(30_000); await assertion; expect(vi.getTimerCount()).toBe(0);
    pending.resolve(result); await Promise.resolve();
    const retry = vi.fn().mockResolvedValue(result); expect(await attempts.run(input, retry)).toEqual(result); expect(retry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
  });
});
