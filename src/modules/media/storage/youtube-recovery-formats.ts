import { z } from "zod";

const formatSchema = z.object({
  format_id: z.string().regex(/^[a-zA-Z0-9_-]+$/u),
  vcodec: z.string().default("none"), acodec: z.string().default("none"),
  width: z.number().positive().nullish(), height: z.number().positive().nullish(),
  format_note: z.string().nullish(), language: z.string().nullish(),
  has_drm: z.boolean().nullish(), abr: z.number().nullish(),
});

/** Prefer source resolution, not AI-upscaled formats; preserve Spanish audio. */
export function selectYoutubeRecoveryFormats(input: unknown, expectedId: string, expectedSeconds: number) {
  const metadata = z.object({ id: z.string(), duration: z.number().positive(), formats: z.array(formatSchema) }).parse(input);
  if (metadata.id !== expectedId || Math.abs(metadata.duration - expectedSeconds) > 2) throw new Error("MEDIA_SOURCE_IDENTITY_MISMATCH");
  const candidates = metadata.formats.filter(f => !f.has_drm && !/AI.upscaled/iu.test(f.format_note ?? "") && !/-sr(?:$|-)/u.test(f.format_id));
  const video = candidates.filter(f => f.vcodec !== "none" && f.acodec === "none" && f.width && f.height)
    .sort((a,b) => b.height! - a.height! || b.width! - a.width! || Number(b.vcodec.startsWith("avc1")) - Number(a.vcodec.startsWith("avc1")))[0];
  const audio = candidates.filter(f => f.vcodec === "none" && f.acodec !== "none" && /^es(?:-|$)/u.test(f.language ?? ""))
    .sort((a,b) => Number(b.acodec.startsWith("mp4a")) - Number(a.acodec.startsWith("mp4a")) || Number(/drc/iu.test(a.format_id)) - Number(/drc/iu.test(b.format_id)) || (b.abr ?? 0) - (a.abr ?? 0))[0];
  if (!video || !audio) throw new Error("MEDIA_NATIVE_SPANISH_FORMAT_REQUIRED");
  return { selection: `${video.format_id}+${audio.format_id}`, width: video.width!, height: video.height!, videoCodec: video.vcodec, audioCodec: audio.acodec, duration: metadata.duration };
}

export function verifiedVideoDecode(progress: string, expectedSeconds: number) {
  const seconds = Number([...progress.matchAll(/^out_time_us=(\d+)\r?$/gmu)].at(-1)?.[1]) / 1e6;
  if (!progress.includes("progress=end") || !Number.isFinite(seconds) || Math.abs(seconds - expectedSeconds) > 2) throw new Error("MEDIA_DECODE_DURATION_MISMATCH");
  return seconds;
}
