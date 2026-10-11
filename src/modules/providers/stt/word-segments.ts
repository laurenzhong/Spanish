import { SpeechToTextError, type TranscriptSegment } from "./transcription";

/** Group provider word units without estimating any time inside a unit. */
export function groupWordSegments(units: readonly TranscriptSegment[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  let current: {
    text: string;
    startMs: number;
    endMs: number;
    speaker: string | null;
    confidence: null;
    words: NonNullable<TranscriptSegment["words"]>[number][];
  } | null = null;
  let previousEnd = 0;
  for (const unit of units) {
    const text = unit.text.trim();
    if (!text) continue;
    if (unit.startMs < previousEnd || unit.endMs <= unit.startMs) {
      throw new SpeechToTextError("provider-response-invalid", "Word timestamps overlap or are invalid.", false);
    }
    previousEnd = unit.endMs;
    if (
      current
      && (current.speaker !== unit.speaker
        || unit.startMs - current.endMs > 1_000
        || current.text.length >= 240
        || /[.!?…][”"']?$/u.test(current.text))
    ) {
      result.push(current);
      current = null;
    }
    if (!current) {
      current = { text: "", startMs: unit.startMs, endMs: unit.endMs, speaker: unit.speaker, confidence: null, words: [] };
    }
    const separator = current.text && !/^[,.;:!?…]/u.test(text) ? " " : "";
    const base = current.text.length + separator.length;
    current.text += separator + text;
    current.endMs = unit.endMs;
    const matches = Array.from(text.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?/gu));
    if (matches.length > 1) {
      throw new SpeechToTextError("provider-response-invalid", "The provider did not return word-level units.", false);
    }
    if (matches[0]) {
      current.words.push({
        startMs: unit.startMs,
        endMs: unit.endMs,
        startOffset: base + matches[0].index,
        endOffset: base + matches[0].index + matches[0][0].length,
      });
    }
  }
  if (current) result.push(current);
  return result;
}
