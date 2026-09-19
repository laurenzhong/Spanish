import "dotenv/config";

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createDatabaseConnection } from "../src/shared/db/client";
import * as schema from "../src/shared/db/schema";
import { and, eq } from "drizzle-orm";
import { createOpenAITranscriptionProvider } from "../src/modules/providers/stt/openai-transcription";
import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";
import { createMiniMaxTranslationProvider } from "../src/modules/providers/translation/minimax-translation";
import { createOpenAITranslationProvider } from "../src/modules/providers/translation/openai-translation";
import { backfillPublishedMediaTranscript, type PublishedMediaTranscriptCandidate } from "../src/modules/media/application/backfill-published-media-transcript";
import { createDrizzleMediaRepository } from "../src/modules/media/repositories/drizzle-media-repository";
import type { MediaAudioAssetProvider } from "../src/modules/content-acquisition/application/process-media-candidate";
import { pcmAudioChunks } from "../src/modules/content-acquisition/processors/pcm-audio-chunks";

const MAX_BYTES = 512 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(["content.libsyn.com", "traffic.libsyn.com", "traffic.megaphone.fm", "dcs-spotify.megaphone.fm", "ztnr.rtve.es", "rtve-mediavod-lote3.rtve.es"]);
const ALLOWED_STORAGE_HOST_SUFFIX = ".supabase.co";
const bunnyHost = process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME?.trim().toLowerCase();
if (bunnyHost) ALLOWED_HOSTS.add(bunnyHost);
// ffmpeg-static ships a platform-specific binary. On Windows the package in
// some pnpm environments can resolve to a non-native executable, so prefer a
// configured/PATH ffmpeg and fail with an actionable error from spawn.
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || (process.platform === "win32" ? "ffmpeg" : ((await import("ffmpeg-static")).default || "ffmpeg"));

function parseArgs(args: readonly string[]) {
  const index = args.indexOf("--stable-key");
  const stableKey = index >= 0 ? args[index + 1] : undefined;
  if (!stableKey || stableKey.startsWith("--")) throw new Error("--stable-key is required and must name exactly one published media item.");
  if (process.env.MEDIA_TRANSCRIPT_BACKFILL_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("Set MEDIA_TRANSCRIPT_BACKFILL_CONFIRM=I_HAVE_AUTHORIZATION to authorize one real ASR run.");
  return { stableKey };
}

async function main() {
  const { stableKey } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const [row] = await connection.db.select({ item: schema.mediaItems, version: schema.mediaVersions, asset: schema.mediaAssets })
      .from(schema.mediaItems)
      .innerJoin(schema.mediaVersions, and(eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id), eq(schema.mediaVersions.version, schema.mediaItems.currentVersion)))
      .innerJoin(schema.mediaAssets, and(eq(schema.mediaAssets.mediaVersionId, schema.mediaVersions.id), eq(schema.mediaAssets.availability, "available")))
      .where(and(eq(schema.mediaItems.stableKey, stableKey), eq(schema.mediaVersions.status, "published"), eq(schema.mediaVersions.copyrightStatus, "cleared")))
      .limit(1);
    if (!row) throw new Error("MEDIA_NOT_FOUND_OR_UNAVAILABLE");
    if (row.asset.kind === "official_embed") throw new Error("MEDIA_TRANSCRIPT_VIDEO_AUDIO_REQUIRED: official embeds cannot be downloaded; use an authorized hosted video asset.");
    const parsed = new URL(row.asset.playbackUrl);
    if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase()) && !parsed.hostname.endsWith(ALLOWED_STORAGE_HOST_SUFFIX)) throw new Error("MEDIA_AUDIO_HOST_NOT_ALLOWED");
    const localMediaFile = process.env.MEDIA_TRANSCRIPT_LOCAL_MEDIA_FILE?.trim() || null;
    const localBytes = localMediaFile ? new Uint8Array(await readFile(localMediaFile)) : null;
    const head = localBytes ? null : await fetchWithRetry(parsed, { method: "HEAD", redirect: "follow" }, 3, 30_000);
    const contentLength = localBytes?.byteLength ?? Number(head?.headers.get("content-length") ?? 0);
    if ((head && !head.ok) || !Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_BYTES) throw new Error("MEDIA_AUDIO_SIZE_CHECK_FAILED");
    const sourceMimeType = (head?.headers.get("content-type") ?? row.asset.mimeType ?? "audio/mpeg").split(";", 1)[0].trim().toLowerCase();
    if (row.asset.kind === "audio" && !sourceMimeType.startsWith("audio/")) throw new Error("MEDIA_AUDIO_MIME_INVALID");
    if (row.asset.kind === "video" && !sourceMimeType.startsWith("video/")) throw new Error("MEDIA_VIDEO_MIME_INVALID");
    const candidate: PublishedMediaTranscriptCandidate = {
      id: row.item.id,
      stableKey: row.item.stableKey, mediaItemId: row.item.id, mediaVersionId: row.version.id, version: row.version.version,
      contentType: row.item.kind, language: row.version.language, rightsStatus: "verified", durationMs: row.version.durationMs,
      assetBytes: contentLength, mimeType: sourceMimeType, fileName: `${row.item.stableKey}.mp3`,
      contentHash: row.version.contentHash,
    };
    const audio: MediaAudioAssetProvider = {
      acquire: async (input, options) => {
        const sourceBytes = localBytes ?? await (async () => {
          return downloadBytesWithRetry(parsed, options?.signal, 3, 120_000);
        })();
        const bytes = await transcodeForTranscription(sourceBytes, options?.signal);
        if (bytes.byteLength <= 0 || bytes.byteLength > MAX_BYTES) throw new Error("MEDIA_AUDIO_SIZE_CHECK_FAILED");
        const { createHash } = await import("node:crypto");
        const contentHash = createHash("sha256").update(bytes).digest("hex");
        return { bytes, preparedChunks: pcmAudioChunks(bytes), mimeType: "audio/wav", fileName: `${input.fileName.replace(/\.[^.]+$/u, "")}.wav`, contentHash, storageKey: null };
      },
      release: async () => "deleted",
    };
    const policy = {
      dailyCostLimitMicros: Number(process.env.MEDIA_TRANSCRIPT_DAILY_LIMIT_MICROS ?? 5_000_000),
      monthlyCostLimitMicros: Number(process.env.MEDIA_TRANSCRIPT_MONTHLY_LIMIT_MICROS ?? 20_000_000),
      maxCandidateBytes: MAX_BYTES,
      maxDurationSeconds: Number(process.env.MEDIA_TRANSCRIPT_MAX_DURATION_SECONDS ?? 7_200),
    } as const;
    const estimatedCostMicros = Number(process.env.MEDIA_TRANSCRIPT_ESTIMATED_COST_MICROS ?? 1_000_000);
    const translationProviderName = process.env.MEDIA_TRANSCRIPT_TRANSLATION_PROVIDER?.trim().toLowerCase() || "openai";
    if (!["openai", "minimax"].includes(translationProviderName)) throw new Error("MEDIA_TRANSCRIPT_TRANSLATION_PROVIDER must be openai or minimax.");
    const translation = process.env.MEDIA_TRANSCRIPT_TRANSLATE === "1"
      ? translationProviderName === "openai"
        ? createOpenAITranslationProvider({ endpoint: process.env.OPENAI_TRANSLATION_API_ENDPOINT?.trim() || "https://api.openai.com/v1/chat/completions", modelVersion: process.env.OPENAI_TRANSLATION_MODEL?.trim() || "gpt-4.1-mini" })
        : createMiniMaxTranslationProvider()
      : undefined;
    const providerName = (process.env.MEDIA_TRANSCRIPT_PROVIDER?.trim().toLowerCase() || "openai");
    const transcriptionProvider = providerName === "minimax"
      ? createMiniMaxTranscriptionProvider({ timestampLevel: "word", endpoint: process.env.MINIMAX_TRANSCRIPTION_API_ENDPOINT?.trim() || "https://api.minimaxi.com/v1/speech_to_text" })
      : providerName === "openai"
        ? createOpenAITranscriptionProvider({ model: "whisper-1", wordTimestamps: true, timeoutMs: 120_000, endpoint: process.env.OPENAI_TRANSCRIPTION_API_ENDPOINT?.trim() || "https://api.openai.com/v1/audio/transcriptions" })
        : (() => { throw new Error("MEDIA_TRANSCRIPT_PROVIDER must be minimax or openai."); })();
    const result = await backfillPublishedMediaTranscript({
      candidate: { ...candidate, mimeType: row.asset.kind === "video" ? "video/mp4" : sourceMimeType }, audio,
      transcriptionProvider: { transcribe: async (input, options) => {
        console.log(JSON.stringify({ stage: "transcribing", file: input.fileName, bytes: input.audioBytes.length }));
        const response = await transcriptionProvider.transcribe(input, options);
        console.log(JSON.stringify({ stage: "transcribed", segments: response.segments?.length ?? 0 }));
        return response;
      } }, translationProvider: translation,
      replaceExistingDraft: process.env.MEDIA_TRANSCRIPT_REFRESH_DRAFT === "1",
      repository: createDrizzleMediaRepository(connection.db), budgetPolicy: policy, budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 }, estimatedCostMicros,
    });
    process.stdout.write(`${JSON.stringify({ stableKey, status: "draft", ...result })}\n`);
  } finally {
    await connection.client.end();
  }
}

async function transcodeForTranscription(source: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw new Error("MEDIA_AUDIO_DOWNLOAD_CANCELLED");
  const child = spawn(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const pipeInput = pipeline(Readable.from((async function* () {
      const bytes = Buffer.from(source);
      const blockSize = 1024 * 1024;
      for (let offset = 0; offset < bytes.length; offset += blockSize) yield bytes.subarray(offset, Math.min(bytes.length, offset + blockSize));
    })()), child.stdin).catch((error: unknown) => error);
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code ?? 1));
    });
    const inputResult = await pipeInput;
    if (signal?.aborted) throw new Error("MEDIA_AUDIO_DOWNLOAD_CANCELLED");
    if (exitCode !== 0) throw new Error(`MEDIA_AUDIO_TRANSCODE_FAILED${errors.length ? `: ${Buffer.concat(errors).toString("utf8").slice(0, 200)}` : ""}`);
    if (inputResult instanceof Error) throw new Error("MEDIA_AUDIO_TRANSCODE_INPUT_FAILED", { cause: inputResult });
    const output = new Uint8Array(Buffer.concat(chunks));
    if (output.byteLength <= 0 || output.byteLength > MAX_BYTES) throw new Error("MEDIA_AUDIO_TRANSCRIBE_SIZE_FAILED");
    return output;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!child.killed) child.kill();
  }
}

async function downloadBytesWithRetry(input: URL, signal: AbortSignal | undefined, attempts: number, timeoutMs: number): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchWithRetry(input, { redirect: "follow", signal }, 1, timeoutMs);
      if (!response.ok) throw new Error("MEDIA_AUDIO_DOWNLOAD_FAILED");
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MEDIA_AUDIO_DOWNLOAD_FAILED");
}

async function fetchWithRetry(input: URL, init: RequestInit, attempts: number, timeoutMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) throw error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MEDIA_AUDIO_FETCH_FAILED");
}

main().catch((error: unknown) => {
  let cause = error instanceof Error ? error.cause : undefined;
  while (cause instanceof Error) {
    if (["SpeechToTextError", "MediaTranscriptionError"].includes(cause.name) || "code" in cause) process.stderr.write(`${JSON.stringify({ stage: "failure-detail", code: "code" in cause ? cause.code : cause.name, message: cause.message })}\n`);
    cause = cause.cause;
  }
  process.stderr.write(`${JSON.stringify({ code: error instanceof Error && "code" in error ? error.code : "MEDIA_TRANSCRIPT_BACKFILL_FAILED", message: error instanceof Error ? error.message : "Media transcript backfill failed." })}\n`);
  process.exitCode = 1;
});
