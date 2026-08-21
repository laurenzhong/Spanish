import { describe, expect, it } from "vitest";

import { BrowserAudioRecorder } from "@/src/modules/providers/speech";
import { BrowserTextToSpeech } from "@/src/modules/providers/tts";

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

  it("reports an unavailable browser without touching media APIs", () => {
    const recorder = new BrowserAudioRecorder(null, null);
    const tts = new BrowserTextToSpeech(null, null);

    expect(recorder.isSupported).toBe(false);
    expect(tts.isSupported).toBe(false);
  });
});
