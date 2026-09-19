import { describe, expect, it } from "vitest";

import { segmentMediaTranscript } from "@/src/modules/content-acquisition";
import { maxMediaSegments } from "@/src/modules/media/domain";

describe("media transcript segmentation", () => {
  it("creates ordered, non-overlapping sentence cues", () => {
    const segments = segmentMediaTranscript({ text: "Hola. ¿Qué tal? Muy bien.", durationMs: 9_000, confidence: 0.91 });
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({ index: 0, startMs: 0, sourceText: "Hola.", sourceKind: "asr" });
    expect(segments.at(-1)?.endMs).toBe(9_000);
    expect(segments.every((segment) => segment.endMs > segment.startMs)).toBe(true);
  });

  it("rejects empty transcripts", () => {
    expect(() => segmentMediaTranscript({ text: " ", durationMs: 1_000, confidence: null })).toThrow("empty");
  });

  it("allows the shared long-media cue limit", () => {
    const text = Array.from({ length: maxMediaSegments }, (_, index) => `S${index}.`).join(" ");
    expect(segmentMediaTranscript({ text, durationMs: maxMediaSegments, confidence: null })).toHaveLength(maxMediaSegments);
  });
});
