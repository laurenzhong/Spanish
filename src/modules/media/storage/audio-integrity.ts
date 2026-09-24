/** MP3 headers can claim the full duration even when the downloaded tail is missing. */
export function verifiedDecodedAudioDuration(progress: string, expectedSeconds: number): number {
  const elapsed = Number([...progress.matchAll(/^out_time_ms=(\d+)$/gmu)].at(-1)?.[1]) / 1_000_000;
  if (!/^progress=end$/mu.test(progress)) throw new Error("AUDIO_DECODE_FAILED");
  if (!Number.isFinite(expectedSeconds) || expectedSeconds <= 0 || !Number.isFinite(elapsed) || elapsed <= 0 || Math.abs(elapsed - expectedSeconds) > 5) {
    throw new Error("AUDIO_DECODE_DURATION_MISMATCH");
  }
  return elapsed;
}
