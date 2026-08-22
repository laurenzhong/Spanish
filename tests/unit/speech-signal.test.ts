import { describe, expect, it } from "vitest";

import {
  LocalSpeechSignalAnalyzer,
  SpeechSignalError,
  type DecodedSpeechSignal,
  type SpeechSignalInput,
} from "@/src/modules/providers/speech";

const input: SpeechSignalInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/mp3",
  locale: "es-ES",
  attemptId: "00000000-0000-4000-8000-000000000101",
  generationId: 7,
};

describe("LocalSpeechSignalAnalyzer", () => {
  it("extracts bounded voice and pause observations from decoded PCM", async () => {
    const analyzer = new LocalSpeechSignalAnalyzer({
      clock: () => 0,
      decoder: async () => ({
        sampleRate: 1_000,
        monoSamples: samplesFromFrames([
          ...repeatedFrames(5, 0.2),
          ...repeatedFrames(8, 0),
          ...repeatedFrames(5, 0.2),
        ]),
      }),
    });

    await expect(analyzer.analyze(input)).resolves.toEqual({
      quality: "usable",
      durationMs: 360,
      voicedRatio: 0.556,
      pauseCount: 1,
      pauseRatio: 0.444,
      analyzer: "local-signal",
      algorithmVersion: "local-signal-v1",
      latencyMs: 0,
      retentionPolicy: "ephemeral",
    });
  });

  it("marks silence as insufficient without negative scores", async () => {
    const analyzer = new LocalSpeechSignalAnalyzer({
      decoder: async () => ({
        sampleRate: 1_000,
        monoSamples: new Float32Array(300),
      }),
    });

    await expect(analyzer.analyze(input)).resolves.toMatchObject({
      quality: "insufficient",
      durationMs: 300,
      voicedRatio: null,
      pauseCount: null,
      pauseRatio: null,
    });
  });

  it("maps decoder failures to a stable local error", async () => {
    const analyzer = new LocalSpeechSignalAnalyzer({
      decoder: async () => {
        throw new Error("decoder exploded");
      },
    });

    await expect(analyzer.analyze(input)).rejects.toMatchObject({
      code: "audio-decode-failed",
      retryable: false,
    });
  });

  it("rejects decoded signals containing non-finite samples", async () => {
    const analyzer = new LocalSpeechSignalAnalyzer({
      decoder: async () => ({
        sampleRate: 1_000,
        monoSamples: new Float32Array([0.2, Number.NaN, 0.2]),
      }),
    });

    await expect(analyzer.analyze(input)).rejects.toMatchObject({
      code: "audio-decode-failed",
    });
  });

  it("does not decode unsupported input", async () => {
    let decodeCalls = 0;
    const analyzer = new LocalSpeechSignalAnalyzer({
      decoder: async () => {
        decodeCalls += 1;
        return validDecodedSignal();
      },
    });

    await expect(
      analyzer.analyze({ ...input, mimeType: "audio/wma" }),
    ).rejects.toMatchObject({ code: "audio-format-unsupported" });
    expect(decodeCalls).toBe(0);
  });

  it("preserves cancellation before decoding", async () => {
    const analyzer = new LocalSpeechSignalAnalyzer({
      decoder: async () => validDecodedSignal(),
    });
    const controller = new AbortController();
    controller.abort();

    await expect(analyzer.analyze(input, { signal: controller.signal })).rejects.toEqual(
      new SpeechSignalError(
        "provider-cancelled",
        "Local signal analysis was cancelled.",
        false,
      ),
    );
  });
});

function validDecodedSignal(): DecodedSpeechSignal {
  return {
    sampleRate: 1_000,
    monoSamples: new Float32Array(200).fill(0.2),
  };
}

function samplesFromFrames(frames: number[][]): Float32Array {
  return new Float32Array(frames.flat());
}

function constantFrame(length: number, value: number): number[] {
  return new Array<number>(length).fill(value);
}

function repeatedFrames(count: number, value: number): number[][] {
  return Array.from({ length: count }, () => constantFrame(20, value));
}
