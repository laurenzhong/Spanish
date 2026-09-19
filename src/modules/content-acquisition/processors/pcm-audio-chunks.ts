import type { MediaAudioChunk } from "./media-transcription-processor";

/** ffmpeg-decoded mono PCM16 at 16 kHz; cuts on sample boundaries, not MP3 bytes. */
export function pcmAudioChunks(pcm: Uint8Array, chunkSeconds = 120): MediaAudioChunk[] {
  if (!pcm.length || pcm.length % 2 || !Number.isInteger(chunkSeconds) || chunkSeconds < 1 || chunkSeconds > 480) throw new Error("MEDIA_PCM_INVALID");
  const bytesPerSecond = 32_000;
  const chunkBytes = bytesPerSecond * chunkSeconds;
  const boundaries: Array<{ start: number; end: number }> = [];
  for (let offset = 0; offset < pcm.length; offset += chunkBytes) boundaries.push({ start: offset, end: Math.min(pcm.length, offset + chunkBytes) });
  const tail = boundaries.at(-1);
  const previous = boundaries.at(-2);
  if (tail && previous && tail.end - tail.start < chunkBytes / 4) {
    previous.end = tail.end;
    boundaries.pop();
  }
  const chunks: MediaAudioChunk[] = [];
  for (const boundary of boundaries) {
    const data = pcm.subarray(boundary.start, boundary.end);
    const wav = new Uint8Array(44 + data.length);
    const view = new DataView(wav.buffer);
    const ascii = (at: number, text: string) => { for (let index = 0; index < text.length; index++) wav[at + index] = text.charCodeAt(index); };
    ascii(0, "RIFF"); view.setUint32(4, 36 + data.length, true); ascii(8, "WAVEfmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, bytesPerSecond, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    ascii(36, "data"); view.setUint32(40, data.length, true); wav.set(data, 44);
    chunks.push({ bytes: wav, startMs: Math.round(boundary.start / 32), endMs: Math.round(boundary.end / 32), index: chunks.length });
  }
  return chunks;
}
