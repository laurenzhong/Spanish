import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ReadAloudService } from "@/src/modules/providers/tts/application/synthesize-read-aloud";
import type { SynthesizedSpeech } from "@/src/modules/providers/tts/minimax-tts";

const result: SynthesizedSpeech = { audio: new Uint8Array([73, 68, 51]), metadata: {
  provider: "minimax", model: "speech-2.8-turbo", voiceId: "Spanish_SereneWoman", requestId: "fake",
  latencyMs: 1, billableCharacters: 4, estimatedCost: null, confidence: null,
} };

describe("private read-aloud application", () => {
  it("deduplicates concurrent and repeated requests only within the same user", async () => {
    const synthesizeDetailed = vi.fn().mockResolvedValue(result);
    const service = new ReadAloudService({ synthesizeDetailed });
    await Promise.all([service.execute("user1", " Hola "), service.execute("user1", "Hola")]);
    await service.execute("user1", "Hola");
    expect(synthesizeDetailed).toHaveBeenCalledTimes(1);
    await service.execute("user2", "Hola");
    expect(synthesizeDetailed).toHaveBeenCalledTimes(2);
  });

  it("detaches a cancelled waiter while keeping the paid generation reusable", async () => {
    let finish!: (audio: SynthesizedSpeech) => void;
    const synthesizeDetailed = vi.fn(() => new Promise<SynthesizedSpeech>((resolve) => { finish = resolve; }));
    const service = new ReadAloudService({ synthesizeDetailed });
    const controller = new AbortController();
    const first = service.execute("user1", "Hola", controller.signal);
    const rejection = expect(first).rejects.toMatchObject({ code: "cancelled" });
    const second = service.execute("user1", "Hola");
    await Promise.resolve(); controller.abort(); await rejection;
    finish(result); await expect(second).resolves.toEqual(result);
    expect(synthesizeDetailed).toHaveBeenCalledTimes(1);
  });

  it("expires results and retains a short tombstone for failed generations", async () => {
    let now = 0;
    const synthesizeDetailed = vi.fn().mockRejectedValueOnce(new Error("uncertain")).mockResolvedValue(result);
    const service = new ReadAloudService({ synthesizeDetailed }, () => now);
    await expect(service.execute("user1", "Hola")).rejects.toThrow("uncertain");
    await expect(service.execute("user1", "Hola")).rejects.toThrow("uncertain");
    expect(synthesizeDetailed).toHaveBeenCalledTimes(1);
    now = 30_001; await service.execute("user1", "Hola");
    expect(synthesizeDetailed).toHaveBeenCalledTimes(2);
    now += 600_001; await service.execute("user1", "Hola");
    expect(synthesizeDetailed).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid or cancelled inputs before touching the provider", async () => {
    const synthesizeDetailed = vi.fn(); const service = new ReadAloudService({ synthesizeDetailed });
    await expect(service.execute("", "Hola")).rejects.toThrow();
    await expect(service.execute("user", "x".repeat(1001))).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(service.execute("user", "Hola", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(synthesizeDetailed).not.toHaveBeenCalled();
  });

  it("bounds pending generations without evicting a still billable request", async () => {
    const finishers: Array<(audio: SynthesizedSpeech) => void> = [];
    const synthesizeDetailed = vi.fn(() => new Promise<SynthesizedSpeech>((resolve) => finishers.push(resolve)));
    const service = new ReadAloudService({ synthesizeDetailed });
    const pending = Array.from({ length: 128 }, (_, index) => service.execute("user", `Hola ${index}`));
    await expect(service.execute("user", "extra")).rejects.toMatchObject({ code: "rate-limited" });
    const repeated = service.execute("user", "Hola 0");
    await Promise.resolve();
    expect(synthesizeDetailed).toHaveBeenCalledTimes(128);
    for (const finish of finishers) finish(result);
    await Promise.all([...pending, repeated]);
    expect(synthesizeDetailed).toHaveBeenCalledTimes(128);
  });
});
