import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadAloud, splitReadAloudText } from "@/src/modules/providers/tts/read-aloud";

class FakeAudio extends EventTarget {
  src = "";
  playbackRate = 1;
  currentTime = 0;
  duration = 1;
  play = vi.fn(async () => undefined);
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
}

function setup(fetcher = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([73, 68, 51, 1]), {
  headers: { "content-type": "audio/mpeg" },
})), subscribeSessionChanges: (invalidate: () => void) => () => void = () => () => undefined) {
  const audio = new FakeAudio();
  const revokeObjectURL = vi.fn();
  const adapter = createReadAloud({
    fetch: fetcher as typeof fetch,
    createAudio: () => audio as unknown as HTMLAudioElement,
    createObjectURL: () => "blob:audio",
    revokeObjectURL,
    subscribeSessionChanges,
  });
  adapters.push(adapter);
  return { audio, adapter, fetcher, revokeObjectURL };
}

const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const adapters: ReturnType<typeof createReadAloud>[] = [];
afterEach(() => { for (const adapter of adapters.splice(0)) adapter.stop(); vi.useRealTimers(); });

describe("MiniMax read-aloud client", () => {
  it("replays completed audio without the weak-network request and keeps playback speed local", async () => {
    const { adapter, audio, fetcher } = setup();
    const first = adapter.speak("Hola", { languageTag: "es-ES" });
    await settle();
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended"));
    await first;
    fetcher.mockImplementation(() => new Promise<Response>(() => undefined));
    const second = adapter.speak("Hola", { languageTag: "es-ES", rate: 0.8 });
    await settle();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(audio.playbackRate).toBe(0.8);
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended"));
    await second;
  });

  it("does not share private audio between controllers", async () => {
    const first = setup(); const second = setup();
    for (const item of [first, second]) {
      const playing = item.adapter.speak("Un mensaje privado", { languageTag: "es-ES" });
      await settle();
      item.audio.dispatchEvent(new Event("playing")); item.audio.dispatchEvent(new Event("ended"));
      await playing;
      expect(item.fetcher).toHaveBeenCalledOnce();
    }
  });

  it("cancels on an auth change and never caches the previous session's late response", async () => {
    let invalidate!: () => void;
    let resolve!: (response: Response) => void;
    const unsubscribe = vi.fn();
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    const { adapter, audio } = setup(fetcher, (callback) => { invalidate = callback; return unsubscribe; });
    const first = adapter.speak("Privado", { languageTag: "es-ES" });
    const cancelled = expect(first).rejects.toMatchObject({ code: "tts-cancelled" });
    await settle(); invalidate(); await cancelled;
    expect(unsubscribe).toHaveBeenCalledOnce();
    resolve(new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "content-type": "audio/mpeg" } }));
    await settle(); expect(audio.play).toHaveBeenCalledOnce();
    fetcher.mockImplementation(async () => new Response(new Uint8Array([73, 68, 51, 1]), { headers: { "content-type": "audio/mpeg" } }));
    const next = adapter.speak("Privado", { languageTag: "es-ES" }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await next;
  });

  it("requests audio again after a decoding failure instead of retaining a failed response", async () => {
    const { adapter, audio, fetcher } = setup();
    const first = adapter.speak("Hola", { languageTag: "es-ES" });
    const rejected = expect(first).rejects.toMatchObject({ code: "tts-no-audio" });
    await settle(); audio.dispatchEvent(new Event("error")); await rejected;
    const next = adapter.speak("Hola", { languageTag: "es-ES" }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await next;
  });

  it.each(["stop", "hidden", "pagehide", "signed-out"])("clears replay audio after %s even when idle", async (reason) => {
    const { adapter, audio, fetcher } = setup();
    const first = adapter.speak("Hola", { languageTag: "es-ES" });
    await settle();
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await first;
    if (reason === "stop") adapter.stop();
    if (reason === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValueOnce("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    }
    if (reason === "pagehide") window.dispatchEvent(new Event("pagehide"));
    if (reason === "signed-out") window.dispatchEvent(new Event("account-signed-out"));
    const next = adapter.speak("Hola", { languageTag: "es-ES" }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await next;
  });

  it("expires replay audio after one minute rather than retaining private content indefinitely", async () => {
    vi.useFakeTimers();
    const { adapter, audio, fetcher } = setup();
    const first = adapter.speak("Hola", { languageTag: "es-ES" }); await settle();
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await first;
    await vi.advanceTimersByTimeAsync(60_001);
    const next = adapter.speak("Hola", { languageTag: "es-ES" }); await settle();
    expect(fetcher).toHaveBeenCalledTimes(2);
    audio.dispatchEvent(new Event("playing")); audio.dispatchEvent(new Event("ended")); await next;
  });

  it("starts a long text with at most 180 characters while preserving its entire source", () => {
    const source = "Una frase completa. ".repeat(140);
    const chunks = splitReadAloudText(source);
    expect(chunks[0]!.length).toBeLessThanOrEqual(180);
    expect(chunks.join("")).toBe(source);
    expect(chunks.slice(1).some((chunk) => chunk.length > 180)).toBe(true);
  });

  it("sends private no-store POST, uses local rate and completes only after ended", async () => {
    const { adapter, audio, fetcher, revokeObjectURL } = setup();
    const onStart = vi.fn();
    const done = vi.fn();
    const speaking = adapter.speak("Hola", { languageTag: "es-ES", rate: 0.8, onStart }).then(done);
    expect(audio.play).toHaveBeenCalledTimes(1); // Unlock happens in the user gesture.
    await settle();
    expect(fetcher).toHaveBeenCalledWith("/api/v1/tts", expect.objectContaining({
      method: "POST", cache: "no-store", credentials: "same-origin",
      body: JSON.stringify({ text: "Hola", languageTag: "es-ES" }),
    }));
    expect(audio.playbackRate).toBe(0.8);
    expect(done).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("playing"));
    expect(onStart).toHaveBeenCalledTimes(1);
    audio.dispatchEvent(new Event("ended"));
    await speaking;
    expect(done).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:audio");
  });

  it("preserves every character of long text and fetches each chunk after previous ended", async () => {
    const text = Array.from({ length: 140 }, (_, index) => `Una frase número ${index}. `).join("");
    const chunks = splitReadAloudText(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 1000)).toBe(true);
    const { adapter, audio, fetcher } = setup();
    const onStart = vi.fn();
    const speaking = adapter.speak(text, { languageTag: "es-ES", onStart });
    for (let i = 0; i < chunks.length; i++) {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(i + 1);
      expect(JSON.parse(fetcher.mock.calls[i]![1]!.body as string).text).toBe(chunks[i]);
      audio.dispatchEvent(new Event("playing"));
      audio.dispatchEvent(new Event("ended"));
    }
    await speaking;
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("aborts pending synthesis without retry and isolates old fetch responses", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((r) => { resolve = r; }));
    const { adapter, audio } = setup(fetcher);
    const speaking = adapter.speak("Hola", { languageTag: "es-ES" });
    const cancelled = expect(speaking).rejects.toMatchObject({ code: "tts-cancelled" });
    await settle();
    const signal = fetcher.mock.calls[0]![1]!.signal as AbortSignal;
    adapter.stop();
    await cancelled;
    expect(signal.aborted).toBe(true);
    resolve(new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } }));
    await settle();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("allows only one active owner and an old owner's stop cannot stop its successor", async () => {
    const first = setup();
    const second = setup();
    const previous = first.adapter.speak("Uno", { languageTag: "es-ES" });
    const cancelled = expect(previous).rejects.toMatchObject({ code: "tts-cancelled" });
    await settle();
    const current = second.adapter.speak("Dos", { languageTag: "es-ES" });
    await cancelled;
    await settle();
    first.adapter.stop();
    const pauses = second.audio.pause.mock.calls.length;
    expect(pauses).toBe(1); // Only the silent unlock was paused.
    second.audio.dispatchEvent(new Event("playing"));
    second.audio.dispatchEvent(new Event("ended"));
    await current;
  });

  it.each([
    ["text/html", "<html>no audio</html>"],
    ["audio/mpeg", "{\"error\":\"oops\"}"],
    ["audio/mpeg", ""],
  ])("rejects malformed binary without playback (%s)", async (type, body) => {
    const { adapter, audio, fetcher } = setup(vi.fn(async () => new Response(body, { headers: { "content-type": type } })));
    await expect(adapter.speak("Hola", { languageTag: "es-ES" })).rejects.toMatchObject({ code: "tts-no-audio" });
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("times out fetches even if the transport ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const { adapter, fetcher } = setup(vi.fn(() => new Promise<Response>(() => undefined)));
    const speaking = adapter.speak("Hola", { languageTag: "es-ES" });
    const rejected = expect(speaking).rejects.toMatchObject({ code: "tts-stalled" });
    await settle();
    await vi.advanceTimersByTimeAsync(45_000);
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects stalled or undecodable playback and releases its URL", async () => {
    vi.useFakeTimers();
    const { adapter, audio, revokeObjectURL } = setup();
    const speaking = adapter.speak("Hola", { languageTag: "es-ES" });
    const rejected = expect(speaking).rejects.toMatchObject({ code: "tts-stalled" });
    await settle();
    audio.dispatchEvent(new Event("playing"));
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("stops when the document becomes hidden and removes lifecycle handlers", async () => {
    const { adapter } = setup();
    const speaking = adapter.speak("Hola", { languageTag: "es-ES" });
    const cancelled = expect(speaking).rejects.toMatchObject({ code: "tts-cancelled" });
    await settle();
    vi.spyOn(document, "visibilityState", "get").mockReturnValueOnce("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await cancelled;
  });

  it("rejects autoplay denial before requesting paid synthesis", async () => {
    const { adapter, audio, fetcher } = setup();
    audio.play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await expect(adapter.speak("Hola", { languageTag: "es-ES" })).rejects.toMatchObject({ code: "tts-failed" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not retry authorization or upstream failures", async () => {
    const { adapter, fetcher } = setup(vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(adapter.speak("Hola", { languageTag: "es-ES" })).rejects.toMatchObject({ code: "tts-failed" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a truncated binary response before playback", async () => {
    const { adapter, audio } = setup(vi.fn(async () => new Response(new Uint8Array([73, 68, 51, 1]), {
      headers: { "content-type": "audio/mpeg", "content-length": "100" },
    })));
    await expect(adapter.speak("Hola", { languageTag: "es-ES" })).rejects.toMatchObject({ code: "tts-no-audio" });
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it("times out silent startup without reporting onStart", async () => {
    vi.useFakeTimers();
    const { adapter, revokeObjectURL } = setup();
    const onStart = vi.fn();
    const speaking = adapter.speak("Hola", { languageTag: "es-ES", onStart });
    const rejected = expect(speaking).rejects.toMatchObject({ code: "tts-stalled" });
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(onStart).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("rejects decoding errors and cannot resurrect callbacks after stopping", async () => {
    const { adapter, audio, revokeObjectURL } = setup();
    const onStart = vi.fn();
    const speaking = adapter.speak("Hola", { languageTag: "es-ES", onStart });
    const rejected = expect(speaking).rejects.toMatchObject({ code: "tts-no-audio" });
    await settle();
    audio.dispatchEvent(new Event("error"));
    await rejected;
    audio.dispatchEvent(new Event("playing"));
    expect(onStart).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("keeps surrogate pairs intact when forced to split a long unbroken string", () => {
    const text = "x😀😀😀😀x";
    const chunks = splitReadAloudText(text, 4);
    expect(chunks.join("")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 4 && !/[\uD800-\uDBFF]$/u.test(chunk))).toBe(true);
  });

  it.each(["es", "es-MX", "ES", "es-Latn-ES"])("normalizes Spanish source locale %s to the shared voice policy", async (languageTag) => {
    const { adapter, audio, fetcher } = setup();
    const speaking = adapter.speak("Hola", { languageTag });
    await settle();
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ text: "Hola", languageTag: "es-ES" });
    audio.dispatchEvent(new Event("playing"));
    audio.dispatchEvent(new Event("ended"));
    await speaking;
  });

  it.each(["en", "es_ES", "es--ES", "es-x", "es-MX "])("rejects unsupported or malformed locale %s before synthesis", async (languageTag) => {
    const { adapter, fetcher } = setup();
    await expect(adapter.speak("Hola", { languageTag })).rejects.toMatchObject({ code: "tts-not-supported" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves long whitespace in splitting while skipping empty synthesis requests", async () => {
    const text = `${" ".repeat(1500)}Hola.${" ".repeat(2500)}Adiós.${" ".repeat(1500)}`;
    const chunks = splitReadAloudText(text);
    expect(chunks.join("")).toBe(text);
    expect(chunks.some((chunk) => !chunk.trim())).toBe(true);
    const audible = chunks.filter((chunk) => chunk.trim());
    const { adapter, audio, fetcher } = setup();
    const speaking = adapter.speak(text, { languageTag: "es-ES" });
    for (let index = 0; index < audible.length; index++) {
      await settle();
      expect(fetcher).toHaveBeenCalledTimes(index + 1);
      expect(JSON.parse(fetcher.mock.calls[index]![1]!.body as string).text).toBe(audible[index]);
      audio.dispatchEvent(new Event("playing"));
      audio.dispatchEvent(new Event("ended"));
    }
    await speaking;
    expect(fetcher).toHaveBeenCalledTimes(audible.length);
  });
});

