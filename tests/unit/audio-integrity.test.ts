import { describe, expect, it } from "vitest";
import { verifiedDecodedAudioDuration } from "@/src/modules/media/storage/audio-integrity";

describe("actual decoded audio duration", () => {
  it("uses the final decoded timestamp, not the MP3 header duration", () => {
    expect(verifiedDecodedAudioDuration("out_time_ms=500000\nprogress=continue\nout_time_ms=1105392000\nprogress=end\n", 1106)).toBe(1105.392);
  });
  it("rejects the observed truncated 42-minute cache for a 59-minute episode", () => {
    expect(() => verifiedDecodedAudioDuration("out_time_ms=2555847596\nprogress=end\n", 3548)).toThrow("AUDIO_DECODE_DURATION_MISMATCH");
  });
  it("rejects an unfinished decoder despite a plausible timestamp", () => {
    expect(() => verifiedDecodedAudioDuration("out_time_ms=1105392000\nprogress=continue\n", 1106)).toThrow("AUDIO_DECODE_FAILED");
  });
  it.each(["progress=end\n", "out_time_ms=0\nprogress=end\n", "out_time_ms=invalid\nprogress=end\n"])("rejects absent or invalid elapsed time", (progress) => {
    expect(() => verifiedDecodedAudioDuration(progress, 1106)).toThrow("AUDIO_DECODE_DURATION_MISMATCH");
  });
});
