import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserAudioRecorder } from "@/src/modules/providers/speech";
import { BrowserTextToSpeech, defaultSpanishVoiceName, preferredSpanishVoice } from "@/src/modules/providers/tts";

type FakeUtterance = {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onstart: ((event: SpeechSynthesisEvent) => void) | null;
  onend: ((event: SpeechSynthesisEvent) => void) | null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null;
};

function createUtteranceFactory() {
  const utterances: FakeUtterance[] = [];
  const factory = (text: string) => {
    const utterance: FakeUtterance = { text, lang: "", rate: 1, pitch: 1, voice: null, onstart: null, onend: null, onerror: null };
    utterances.push(utterance);
    return utterance as unknown as SpeechSynthesisUtterance;
  };
  return { utterances, factory };
}

function finish(utterance: FakeUtterance) {
  utterance.onstart?.(new Event("start") as SpeechSynthesisEvent);
  utterance.onend?.(new Event("end") as SpeechSynthesisEvent);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("browser speech capabilities", () => {  it("maps denied microphone permission to a stable error", async () => {
    const recorder = new BrowserAudioRecorder(
      {
        getUserMedia: async () => {
          throw new DOMException("denied", "NotAllowedError");
        },
      },
      () => {
        throw new Error("recorder should not be created");
      },
      () => true,
    );

    await expect(recorder.start()).rejects.toMatchObject({
      code: "microphone-permission-denied",
    });
  });

  it("returns audio metadata and releases tracks when recording stops", async () => {
    let stoppedTracks = 0;
    const stream = {
      getTracks: () => [{ stop: () => stoppedTracks++ }],
    } as unknown as MediaStream;
    type FakeRecorder = {
      state: string;
      ondataavailable: ((event: BlobEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      onstop: ((event: Event) => void) | null;
      start(): void;
      stop(): void;
    };
    const fakeRecorder: FakeRecorder = {
      state: "inactive",
      ondataavailable: null,
      onerror: null,
      onstop: null,
      start() {
        fakeRecorder.state = "recording";
      },
      stop() {
        fakeRecorder.ondataavailable?.({
          data: new Blob(["hola"], { type: "audio/webm" }),
        } as BlobEvent);
        fakeRecorder.state = "inactive";
        fakeRecorder.onstop?.(new Event("stop"));
      },
    };
    const recorder = new BrowserAudioRecorder(
      { getUserMedia: async () => stream },
      () => fakeRecorder as unknown as MediaRecorder,
      () => true,
    );

    await recorder.start();
    const result = await recorder.stop();

    expect(result.metadata).toEqual({
      mimeType: "audio/webm;codecs=opus",
      sizeBytes: 4,
    });
    expect(stoppedTracks).toBe(1);
  });

  it("speaks Spanish with the selected rate and voice", async () => {
    const voice = { name: "Spanish Test", lang: "es-ES", localService: true } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    const synthesis = {
      getVoices: () => [voice],
      cancel: () => undefined,
      speak: (value: SpeechSynthesisUtterance) => finish(value as unknown as FakeUtterance),
    } as unknown as SpeechSynthesis;
    const tts = new BrowserTextToSpeech(synthesis, factory);

    await tts.speak("¿Cómo va todo?", {
      languageTag: "es-ES",
      rate: 0.8,
      voiceName: "Spanish Test",
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0].lang).toBe("es-ES");
    expect(utterances[0].rate).toBe(0.8);
    expect(utterances[0].voice).toBe(voice);
  });

  it("prefers a local voice over a remote one for the same language", async () => {
    const remote = { name: "Remote Spanish", lang: "es-ES", localService: false } as SpeechSynthesisVoice;
    const local = { name: "Local Spanish", lang: "es-ES", localService: true } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    const tts = new BrowserTextToSpeech(
      {
        getVoices: () => [remote, local],
        cancel: () => undefined,
        speak: (value: SpeechSynthesisUtterance) => finish(value as unknown as FakeUtterance),
      } as unknown as SpeechSynthesis,
      factory,
    );

    await tts.speak("Hola", { languageTag: "es-ES" });

    expect(utterances[0].voice).toBe(local);
  });

  it("reports silence instead of hanging when the engine drops the utterance", async () => {
    const cancel = vi.fn();
    const { factory } = createUtteranceFactory();
    // The engine accepts speak() and then fires nothing at all; this is the
    // state that left the reader's 朗读 button looking dead with no feedback.
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak: vi.fn() } as unknown as SpeechSynthesis,
      factory,
    );

    await expect(tts.speak("Después", { languageTag: "es-ES", startupTimeoutMs: 80 })).rejects.toMatchObject({ code: "tts-no-audio" });

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retries the chosen voice before dropping it", async () => {
    const deadVoice = { name: "Dead Spanish", lang: "es-ES", localService: false } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    let calls = 0;
    const synthesis = {
      getVoices: () => [deadVoice],
      cancel: vi.fn(),
      speak: (value: SpeechSynthesisUtterance) => {
        calls += 1;
        // The first (voice-pinned) utterance is silently dropped; the retry works.
        if (calls > 1) finish(value as unknown as FakeUtterance);
      },
    } as unknown as SpeechSynthesis;
    const tts = new BrowserTextToSpeech(synthesis, factory);

    await tts.speak("Después", { languageTag: "es-ES", voiceName: "Dead Spanish", startupTimeoutMs: 80 });

    expect(utterances).toHaveLength(2);
    expect(utterances[0].voice).toBe(deadVoice);
    expect(utterances[1].voice).toBe(deadVoice);
  });

  it("does not cancel the queue after the attempt already ended", async () => {
    const cancel = vi.fn();
    const { factory } = createUtteranceFactory();
    const tts = new BrowserTextToSpeech(
      {
        getVoices: () => [],
        cancel,
        speak: (value: SpeechSynthesisUtterance) => value.onend?.(new Event("end") as SpeechSynthesisEvent),
      } as unknown as SpeechSynthesis,
      factory,
    );

    await tts.speak("Hola", { languageTag: "es-ES", startupTimeoutMs: 80 });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150));

    expect(cancel).not.toHaveBeenCalled();
  });

  it("resolves instead of failing when the user stops a silent utterance", async () => {
    const cancel = vi.fn();
    const { factory } = createUtteranceFactory();
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak: vi.fn() } as unknown as SpeechSynthesis,
      factory,
    );

    const spoken = tts.speak("Hola", { languageTag: "es-ES", startupTimeoutMs: 80 });
    tts.stop();

    await expect(spoken).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("keeps audio that is already playing when the start notification is late", async () => {
    const cancel = vi.fn();
    const { utterances, factory } = createUtteranceFactory();
    // The engine reports itself as speaking from the first moment, but the
    // utterance-level start only arrives after the deadline: cancelling here
    // would cut audible speech and report a false "no audio".
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak: (value: SpeechSynthesisUtterance) => {
        const utterance = utterances[utterances.length - 1];
        globalThis.setTimeout(() => finish(utterance), 150);
        void value;
      }, speaking: true, pending: false } as unknown as SpeechSynthesis,
      factory,
    );

    await expect(tts.speak("Hola", { languageTag: "es-ES", startupTimeoutMs: 80 })).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("reports an interruption when the engine keeps claiming to speak but never starts", async () => {
    const cancel = vi.fn();
    const { utterances, factory } = createUtteranceFactory();
    // Chrome sets `speaking` synchronously even for an utterance it later drops,
    // so the engine's own state may only postpone the verdict, never remove it.
    // The total budget (60 + 8000ms here) must still fire, and because the engine
    // still claims to speak the honest verdict is "interrupted", not "no sound".
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak: vi.fn(), speaking: true, pending: false } as unknown as SpeechSynthesis,
      factory,
    );

    await expect(tts.speak("Hola", { languageTag: "es-ES", startupTimeoutMs: 60 })).rejects.toMatchObject({ code: "tts-stalled" });
    expect(cancel).toHaveBeenCalledTimes(1);
    // No replay: the engine claimed to be playing, so a second utterance could
    // duplicate audio the user already heard.
    expect(utterances).toHaveLength(1);
  }, 60_000);

  it("settles when the engine starts but never reports the end", async () => {
    const cancel = vi.fn();
    const { utterances, factory } = createUtteranceFactory();
    // Chrome and Safari are known to drop `end`; the adapter must stop waiting
    // once the engine is silent again instead of leaving the button on "reading".
    const synthesis = {
      getVoices: () => [],
      cancel,
      speaking: true,
      pending: false,
      speak: (value: SpeechSynthesisUtterance) => {
        value.onstart?.(new Event("start") as SpeechSynthesisEvent);
        setTimeout(() => { synthesis.speaking = false; }, 600);
      },
    };
    const tts = new BrowserTextToSpeech(synthesis as unknown as SpeechSynthesis, factory);

    await expect(tts.speak("Hola", { languageTag: "es-ES" })).resolves.toBeUndefined();
    expect(utterances).toHaveLength(1);
    expect(cancel).not.toHaveBeenCalled();
  }, 20_000);

  it("never cuts a long reading short when the end event is missing", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const { utterances, factory } = createUtteranceFactory();
    // A realistic article-length reading keeps the engine busy for minutes; the
    // runtime bound must stay far above that and resolve as soon as it is quiet.
    const text = "a".repeat(400);
    const synthesis = {
      getVoices: () => [],
      cancel,
      speaking: true,
      pending: false,
      speak: (value: SpeechSynthesisUtterance) => value.onstart?.(new Event("start") as SpeechSynthesisEvent),
    };
    const tts = new BrowserTextToSpeech(synthesis as unknown as SpeechSynthesis, factory);

    let settled = false;
    void tts.speak(text, { languageTag: "es-ES" }).then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(300_000);
    expect(settled).toBe(false);
    expect(cancel).not.toHaveBeenCalled();

    // The engine finishes on its own (still no `end` event): the watcher notices.
    synthesis.speaking = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
    expect(utterances).toHaveLength(1);
  });

  it("fails with tts-stalled when the engine never stops speaking", async () => {
    const cancel = vi.fn();
    const { factory } = createUtteranceFactory();
    const synthesis = {
      getVoices: () => [],
      cancel,
      speaking: true,
      pending: false,
      speak: (value: SpeechSynthesisUtterance) => value.onstart?.(new Event("start") as SpeechSynthesisEvent),
    };
    const tts = new BrowserTextToSpeech(synthesis as unknown as SpeechSynthesis, factory);

    // The runtime bound is deliberately generous (120s floor) so a legitimately
    // long reading is never cut short; a permanently "speaking" engine is still
    // released instead of holding the UI forever.
    await expect(tts.speak("Hola", { languageTag: "es-ES", maxRuntimeMs: 2_000 })).rejects.toMatchObject({ code: "tts-stalled" });
    expect(cancel).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("lets a network voice take longer than a local voice to start", async () => {
    const cancel = vi.fn();
    const remote = { name: "Elvira Online", lang: "es-ES", localService: false, voiceURI: "elvira" } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [remote], cancel, speaking: true, pending: false, speak: (value: SpeechSynthesisUtterance) => {
        const utterance = utterances[utterances.length - 1];
        globalThis.setTimeout(() => finish(utterance), 2_500);
        void value;
      } } as unknown as SpeechSynthesis,
      factory,
    );

    // No explicit startupTimeoutMs: the remote-voice window (6s) must apply.
    await expect(tts.speak("Hola", { languageTag: "es-ES", voiceURI: "elvira" })).resolves.toBeUndefined();
    expect(cancel).not.toHaveBeenCalled();
  }, 10_000);

  it("keeps the caller's voice while the engine stays silent", async () => {
    const cancel = vi.fn();
    const deadVoice = { name: "Dead Spanish", lang: "es-ES", localService: true, voiceURI: "dead" } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    // Both attempts are dropped, so the caller still gets a stable failure and
    // never hears a different voice read the same text twice.
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [deadVoice], cancel, speak: vi.fn() } as unknown as SpeechSynthesis,
      factory,
    );

    await expect(tts.speak("Hola", { languageTag: "es-ES", voiceURI: "dead", startupTimeoutMs: 60 })).rejects.toMatchObject({ code: "tts-no-audio" });

    expect(utterances).toHaveLength(3);
    expect(utterances.slice(0, 2).every((utterance) => utterance.voice === deadVoice)).toBe(true);
    expect(utterances[2].voice).toBeNull();
  });

  it("falls back to the engine default voice after two silent attempts", async () => {
    const cancel = vi.fn();
    const deadVoice = { name: "Dead Spanish", lang: "es-ES", localService: true, voiceURI: "dead" } as SpeechSynthesisVoice;
    const { utterances, factory } = createUtteranceFactory();
    let calls = 0;
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [deadVoice], cancel, speak: (value: SpeechSynthesisUtterance) => {
        calls += 1;
        if (calls > 2) finish(utterances[utterances.length - 1]);
        void value;
      } } as unknown as SpeechSynthesis,
      factory,
    );

    await expect(tts.speak("Hola", { languageTag: "es-ES", voiceURI: "dead", startupTimeoutMs: 60 })).resolves.toBeUndefined();

    expect(utterances).toHaveLength(3);
    expect(utterances[2].voice).toBeNull();
  });

  it("does not cancel an idle queue before the first utterance", async () => {
    const cancel = vi.fn();
    const speak = vi.fn((value: SpeechSynthesisUtterance) => finish(value as unknown as FakeUtterance));
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak } as unknown as SpeechSynthesis,
      (text) => ({ text, lang: "", rate: 1, pitch: 1, voice: null, onstart: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
    );
    await tts.speak("Hola", { languageTag: "es-ES" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("reports an unavailable browser without touching media APIs", () => {
    const recorder = new BrowserAudioRecorder(null, null);
    const tts = new BrowserTextToSpeech(null, null);

    expect(recorder.isSupported).toBe(false);
    expect(tts.isSupported).toBe(false);
  });

  it("cancels and releases microphone tracks when Safari hides the page", async () => {
    let stoppedTracks = 0;
    const page = new EventTarget();
    const visibility = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    visibility.visibilityState = "visible";
    const track = new EventTarget() as EventTarget & { stop(): void };
    track.stop = () => { stoppedTracks += 1; };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const fakeRecorder = {
      state: "inactive",
      ondataavailable: null,
      onerror: null,
      onstop: null as ((event: Event) => void) | null,
      start() { fakeRecorder.state = "recording"; },
      stop() { fakeRecorder.state = "inactive"; fakeRecorder.onstop?.(new Event("stop")); },
    };
    const interrupted = vi.fn();
    const recorder = new BrowserAudioRecorder(
      { getUserMedia: async () => stream },
      () => fakeRecorder as unknown as MediaRecorder,
      () => true,
      { page, visibility, onInterrupted: interrupted },
    );

    await recorder.start();
    page.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(stoppedTracks).toBe(1));
    expect(interrupted).toHaveBeenCalledTimes(1);
    await expect(recorder.stop()).rejects.toMatchObject({ code: "recording-not-active" });
  });

  it("treats an ended audio track as a recoverable interruption", async () => {
    const track = new EventTarget() as EventTarget & { stop(): void };
    track.stop = vi.fn();
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const fakeRecorder = {
      state: "inactive",
      ondataavailable: null,
      onerror: null,
      onstop: null as ((event: Event) => void) | null,
      start() { fakeRecorder.state = "recording"; },
      stop() { fakeRecorder.state = "inactive"; fakeRecorder.onstop?.(new Event("stop")); },
    };
    const interrupted = vi.fn();
    const recorder = new BrowserAudioRecorder(
      { getUserMedia: async () => stream },
      () => fakeRecorder as unknown as MediaRecorder,
      () => true,
      { onInterrupted: interrupted },
    );
    await recorder.start();
    track.dispatchEvent(new Event("ended"));
    await vi.waitFor(() => expect(interrupted).toHaveBeenCalledTimes(1));
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("prefers a saved Spanish voice, then Elvira, then the first available voice", () => {
    const elvira = { name: defaultSpanishVoiceName, lang: "es-ES", voiceURI: "elvira" } as SpeechSynthesisVoice;
    const sofia = { name: "Microsoft Sofia Online (Natural)", lang: "es-BO", voiceURI: "sofia" } as SpeechSynthesisVoice;
    expect(preferredSpanishVoice([sofia, elvira], "sofia")).toBe(sofia);
    expect(preferredSpanishVoice([sofia, elvira], null)).toBe(elvira);
    expect(preferredSpanishVoice([sofia], null)).toBe(sofia);
  });

  it("ignores a stored voice that is not one of the Spanish voices", () => {
    const carmen = { name: "Microsoft Carmen - Spanish (Spain)", lang: "es-ES", voiceURI: "carmen" } as SpeechSynthesisVoice;
    // Another feature stores its own voice in the same key; Spanish text must
    // never be spoken with it.
    expect(preferredSpanishVoice([carmen], "huihui")).toBe(carmen);
    expect(preferredSpanishVoice([carmen], "")).toBe(carmen);
    expect(preferredSpanishVoice([carmen], "carmen")).toBe(carmen);
  });

  it("never returns a non-Spanish voice from a full platform voice list", () => {
    const chinese = { name: "Microsoft Huihui - Chinese (Simplified, PRC)", lang: "zh-CN", voiceURI: "huihui" } as SpeechSynthesisVoice;
    const english = { name: "Microsoft David - English (United States)", lang: "en-US", voiceURI: "david" } as SpeechSynthesisVoice;
    const laura = { name: "Microsoft Laura - Spanish (Spain)", lang: "es-ES", voiceURI: "laura", localService: true } as SpeechSynthesisVoice;
    // The platform lists the system locale first; picking voices[0] made Spanish
    // words read with a Chinese voice.
    expect(preferredSpanishVoice([chinese, english, laura], null)).toBe(laura);
    expect(preferredSpanishVoice([chinese, english], null)).toBeNull();
  });
});
