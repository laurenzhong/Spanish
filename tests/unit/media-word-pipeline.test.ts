import { describe, expect, it } from "vitest";
import { groupWordSegments } from "@/src/modules/providers/stt/word-segments";
import { pcmAudioChunks } from "@/src/modules/content-acquisition/processors/pcm-audio-chunks";
import { transcribeMediaAudio } from "@/src/modules/content-acquisition/processors/media-transcription-processor";
import { validWordTimings } from "@/src/modules/media/domain/word-timeline";

describe("word-aligned media pipeline", () => {
  it("groups actual word units into sentences and retains exact offsets", () => {
    const segments = groupWordSegments(["Hola,", "hola.", "Adiós."].map((text, index) => ({ text, startMs: index * 500, endMs: index * 500 + 400, speaker: "S1", confidence: null })));
    expect(segments.map((segment) => segment.text)).toEqual(["Hola, hola.", "Adiós."]);
    expect(validWordTimings({ ...segments[0], sourceText: segments[0].text })).toHaveLength(2);
    expect(segments[0].words?.[1]).toEqual({ startMs: 500, endMs: 900, startOffset: 6, endOffset: 10 });
  });
  it("rejects sentence units masquerading as words and overlapping timing", () => {
    expect(() => groupWordSegments([{ text: "Hola mundo", startMs: 0, endMs: 400, speaker: null, confidence: null }])).toThrow("word-level");
    expect(() => groupWordSegments([0, 100].map((startMs) => ({ text: "Hola", startMs, endMs: 500, speaker: null, confidence: null })))).toThrow("overlap");
  });
  it("creates independently decodable WAV chunks on sample boundaries", () => {
    const pcm = new Uint8Array(80_000).fill(5);
    const chunks = pcmAudioChunks(pcm, 1);
    expect(chunks.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0,1000],[1000,2000],[2000,2500]]);
    expect(chunks.map((chunk) => chunk.bytes.length)).toEqual([32044,32044,16044]);
    expect(new TextDecoder().decode(chunks[2].bytes.subarray(0,4))).toBe("RIFF");
    expect(new DataView(chunks[2].bytes.buffer).getUint32(40,true)).toBe(16000);
  });
  it("folds a very short trailing PCM remainder into the previous decodable chunk", () => {
    const pcm = new Uint8Array(67_200).fill(5);
    const chunks = pcmAudioChunks(pcm, 1);
    expect(chunks.map(({ startMs, endMs }) => [startMs, endMs])).toEqual([[0,1000],[1000,2100]]);
    expect(chunks.map((chunk) => chunk.bytes.length)).toEqual([32044,35244]);
  });
  it("clamps provider timing drift at the declared media boundary", async () => {
    const result = await transcribeMediaAudio({
      audioBytes: new Uint8Array([1, 2]), durationMs: 1_000, mimeType: "audio/wav", fileName: "sample.wav",
      preparedChunks: [{ bytes: new Uint8Array([1, 2]), startMs: 0, endMs: 1_005, index: 0 }],
      provider: { transcribe: async () => ({
        text: "Hola", detectedLanguages: ["es"], confidence: null, confidenceAvailability: "unavailable",
        provider: "fake", modelVersion: "fake-v1", providerRequestId: null, latencyMs: 1, estimatedCostMicros: 0, retentionPolicy: "ephemeral",
        segments: [{ text: "Hola", startMs: 900, endMs: 1_100, speaker: null, confidence: null, words: [{ startMs: 900, endMs: 1_100, startOffset: 0, endOffset: 4 }] }],
      }) },
    });
    expect(result.segments).toEqual([expect.objectContaining({ startMs: 900, endMs: 1_000, words: [{ startMs: 900, endMs: 1_000, startOffset: 0, endOffset: 4 }] })]);
  });
});
