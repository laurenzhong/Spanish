import { describe, expect, it, vi } from "vitest";

import { BrowserAudioRecorder } from "@/src/modules/providers/speech";
import { BrowserTextToSpeech, defaultSpanishVoiceName, preferredSpanishVoice } from "@/src/modules/providers/tts";

describe("browser speech capabilities", () => {
  it("maps denied microphone permission to a stable error", async () => {
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
    const voice = { name: "Spanish Test", lang: "es-ES" } as SpeechSynthesisVoice;
    let utterance: SpeechSynthesisUtterance | null = null;
    const synthesis = {
      getVoices: () => [voice],
      cancel: () => undefined,
      speak: (value: SpeechSynthesisUtterance) => {
        utterance = value;
        value.onend?.(new Event("end") as SpeechSynthesisEvent);
      },
    } as unknown as SpeechSynthesis;
    const tts = new BrowserTextToSpeech(
      synthesis,
      (text) =>
        ({
          text,
          lang: "",
          rate: 1,
          pitch: 1,
          voice: null,
          onend: null,
          onerror: null,
        }) as unknown as SpeechSynthesisUtterance,
    );

    await tts.speak("¿Cómo va todo?", {
      languageTag: "es-ES",
      rate: 0.8,
      voiceName: "Spanish Test",
    });

    const spokenUtterance = utterance as unknown as SpeechSynthesisUtterance;
    expect(spokenUtterance.lang).toBe("es-ES");
    expect(spokenUtterance.rate).toBe(0.8);
    expect(spokenUtterance.voice).toBe(voice);
  });

  it("resumes a paused synthesis queue before speaking", async () => {
    const resume = vi.fn();
    const speak = vi.fn((value: SpeechSynthesisUtterance) => value.onend?.(new Event("end") as SpeechSynthesisEvent));
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel: vi.fn(), resume, speak } as unknown as SpeechSynthesis,
      (text) => ({ text, lang: "", rate: 1, pitch: 1, voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
    );
    await tts.speak("Hola", { languageTag: "es-ES" });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("does not cancel an idle queue before the first utterance", async () => {
    const cancel = vi.fn();
    const speak = vi.fn((value: SpeechSynthesisUtterance) => value.onend?.(new Event("end") as SpeechSynthesisEvent));
    const tts = new BrowserTextToSpeech(
      { getVoices: () => [], cancel, speak } as unknown as SpeechSynthesis,
      (text) => ({ text, lang: "", rate: 1, pitch: 1, voice: null, onend: null, onerror: null }) as unknown as SpeechSynthesisUtterance,
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
});
