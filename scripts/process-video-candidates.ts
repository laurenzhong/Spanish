import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDatabaseConnection } from "../src/shared/db/client";
import { createDrizzleContentAcquisitionRepository } from "../src/modules/content-acquisition/repositories/drizzle-content-acquisition-repository";
import { prepareVideoCandidateForReview } from "../src/modules/content-acquisition/application/prepare-video-candidate-for-review";
import { processMediaCandidate, type MediaAudioAssetProvider } from "../src/modules/content-acquisition/application/process-media-candidate";
import type { ContentCandidateRecord } from "../src/modules/content-acquisition/repositories/content-acquisition-repository";
import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";
import { createMiniMaxTranslationProvider } from "../src/modules/providers/translation/minimax-translation";
import { pcmAudioChunks } from "../src/modules/content-acquisition/processors/pcm-audio-chunks";
import { calculateVideoCandidateContentHash, createVideoCandidateDraft, videoCandidateDraftSchema } from "../src/modules/content-acquisition/normalizers/youtube-candidate";
import { validateSegmentTimeline } from "../src/modules/media/domain";
import { alignAuthorizedTranscript, fetchLanguageReactorYoutubeTranscript } from "../src/modules/content-acquisition/adapters/language-reactor/authorized-transcript";
import { translateMediaSegments } from "../src/modules/content-acquisition/processors/media-translation-processor";

const CONFIRMATION = "I_HAVE_AUTHORIZATION";
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const YTDLP_BIN = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const YTDLP_PREFIX = process.env.YTDLP_MODULE?.trim() ? ["-m", process.env.YTDLP_MODULE.trim()] : [];
const MAX_SOURCE_BYTES = Number(process.env.MEDIA_TRANSCRIPT_MAX_SOURCE_BYTES ?? 2 * 1024 * 1024 * 1024);
const MAX_PCM_BYTES = 512 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = Number(process.env.MEDIA_VIDEO_COMMAND_TIMEOUT_MS ?? 20 * 60_000);
const DURATION_TOLERANCE_MS = Number(process.env.MEDIA_TRANSCRIPT_DURATION_TOLERANCE_MS ?? 2_000);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command: string, args: readonly string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const errors: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("MEDIA_VIDEO_COMMAND_TIMEOUT")); }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`MEDIA_VIDEO_COMMAND_FAILED${errors.length ? `: ${Buffer.concat(errors).toString("utf8").slice(-600)}` : ""}`));
      else resolve();
    });
  });
}

function runBinary(command: string, args: readonly string[], timeoutMs = COMMAND_TIMEOUT_MS): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("MEDIA_VIDEO_COMMAND_TIMEOUT")); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`MEDIA_VIDEO_TRANSCODE_FAILED${errors.length ? `: ${Buffer.concat(errors).toString("utf8").slice(-600)}` : ""}`));
      else resolve(Buffer.concat(output));
    });
  });
}

function assertConfiguredNumber(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name}_INVALID`);
}

function candidateInput(candidate: ContentCandidateRecord, draft: ReturnType<typeof videoCandidateDraftSchema.parse>) {
  return {
    id: candidate.id,
    contentType: "video" as const,
    language: draft.language,
    rightsStatus: candidate.rightsStatus,
    durationMs: draft.durationMs,
    assetBytes: 0,
    mimeType: "video/mp4",
    fileName: `${draft.stableKey}.mp4`,
    contentHash: draft.contentHash,
  };
}

function cueKey(segment: Readonly<{ startMs: number; endMs: number; sourceText: string }>): string {
  return `${segment.startMs}:${segment.endMs}:${segment.sourceText.trim()}`;
}

async function processOne(repository: ReturnType<typeof createDrizzleContentAcquisitionRepository>, candidate: ContentCandidateRecord): Promise<Readonly<{ id: string; status: string; segments: number }>> {
  const currentDraft = videoCandidateDraftSchema.parse(candidate.metadata.videoDraft);
  if (["platform_manual", "platform_auto"].includes(currentDraft.captionStatus) && currentDraft.segments.length > 0 && currentDraft.segments.every((segment) => segment.translation && segment.words?.length)) {
    return { id: candidate.id, status: "already-processed", segments: currentDraft.segments.length };
  }
  const directory = await mkdtemp(join(tmpdir(), "sueno-video-transcript-"));
  const source = join(directory, "source.mp4");
  const controller = AbortSignal.timeout(Number(process.env.MEDIA_TRANSCRIPT_CANDIDATE_TIMEOUT_MS ?? 30 * 60_000));
  let pcm: Uint8Array | null = null;
  const audio: MediaAudioAssetProvider = {
    acquire: async () => {
      const base = ["--ignore-config", "--no-playlist", "--js-runtimes", "node", "--force-ipv4", "--socket-timeout", "30", "--retries", "3", "--ffmpeg-location", FFMPEG_BIN];
      await run(YTDLP_BIN, [...YTDLP_PREFIX, ...base, "--no-progress", "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "--output", source, `https://www.youtube.com/watch?v=${currentDraft.platformVideoId}`]);
      const sourceInfo = await stat(source);
      if (!sourceInfo.size || sourceInfo.size > MAX_SOURCE_BYTES) throw new Error("MEDIA_VIDEO_SIZE_INVALID");
      pcm = await runBinary(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], COMMAND_TIMEOUT_MS);
      if (!pcm.length || pcm.length > MAX_PCM_BYTES) throw new Error("MEDIA_VIDEO_TRANSCRIBE_SIZE_FAILED");
      const decodedDurationMs = Math.round(pcm.byteLength / 32);
      if (Math.abs(decodedDurationMs - currentDraft.durationMs) > DURATION_TOLERANCE_MS) throw new Error("MEDIA_VIDEO_DURATION_MISMATCH");
      const contentHash = createHash("sha256").update(pcm).digest("hex");
      return { bytes: pcm, mimeType: "audio/wav", fileName: `${currentDraft.stableKey}.wav`, contentHash, preparedChunks: pcmAudioChunks(pcm) };
    },
    release: async () => { await rm(directory, { recursive: true, force: true }); return "deleted"; },
  };
  try {
    const result = await processMediaCandidate({
      candidate: candidateInput(candidate, currentDraft),
      audio,
      transcriptionProvider: createMiniMaxTranscriptionProvider({ timestampLevel: "word" }),
      translationProvider: currentDraft.captionStatus === "platform_manual" ? undefined : createMiniMaxTranslationProvider({ timeoutMs: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_TIMEOUT_MS ?? 120_000) }),
      budgetPolicy: {
        dailyCostLimitMicros: Number(process.env.MEDIA_TRANSCRIPT_DAILY_LIMIT_MICROS ?? 5_000_000),
        monthlyCostLimitMicros: Number(process.env.MEDIA_TRANSCRIPT_MONTHLY_LIMIT_MICROS ?? 20_000_000),
        maxCandidateBytes: MAX_SOURCE_BYTES,
        maxDurationSeconds: Number(process.env.MEDIA_TRANSCRIPT_MAX_DURATION_SECONDS ?? 7_200),
      },
      budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 },
      estimatedCostMicros: Number(process.env.MEDIA_TRANSCRIPT_ESTIMATED_COST_MICROS ?? 1_000_000),
      signal: controller,
    });
    if (!pcm || result.segments.length === 0) throw new Error("MEDIA_VIDEO_TRANSCRIPT_EMPTY");
    validateSegmentTimeline(result.segments, currentDraft.durationMs);
    const authorizedCues = currentDraft.captionStatus === "platform_manual"
      ? currentDraft.segments.map(({ startMs, endMs, sourceText }) => ({ begin: startMs, end: endMs, text: sourceText }))
      : await fetchLanguageReactorYoutubeTranscript(currentDraft.platformVideoId);
    const authorizedSegments = alignAuthorizedTranscript(authorizedCues, result.segments, currentDraft.durationMs, "platform_manual");
    const savedTranslations = new Map(currentDraft.segments.map((segment) => [cueKey(segment), segment.translation?.trim() || null]));
    const segmentsNeedingTranslation = authorizedSegments.map((segment) => ({ ...segment, translation: savedTranslations.get(cueKey(segment)) ?? null }));
    const translated = await translateMediaSegments({
      segments: segmentsNeedingTranslation.filter((segment) => !segment.translation?.trim()),
      provider: createMiniMaxTranslationProvider({ timeoutMs: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_TIMEOUT_MS ?? 120_000) }),
      concurrency: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_CONCURRENCY ?? 4),
      signal: controller,
    });
    const translatedByCue = new Map(translated.segments.map((segment) => [cueKey(segment), segment.translation?.trim() || null]));
    const completedSegments = segmentsNeedingTranslation.map((segment) => ({ ...segment, translation: segment.translation?.trim() || translatedByCue.get(cueKey(segment)) || null }));
    if (translated.failedCount > 0 || completedSegments.some((segment) => !segment.translation?.trim())) throw new Error("MEDIA_AUTHORIZED_TRANSCRIPT_TRANSLATION_INCOMPLETE");
    const nextDraft = createVideoCandidateDraft({
      ...currentDraft,
      captionStatus: "platform_manual",
      segments: completedSegments,
      changeReason: "Reprocessed from the owner-authorized Language Reactor platform transcript; MiniMax supplies translations and aligned word timing only.",
    });
    const updated = await repository.requestCandidateReprocessing({
      candidateId: candidate.id,
      expectedRevision: candidate.revision,
      generationId: randomUUID(),
      metadata: { ...candidate.metadata, videoDraft: nextDraft, mediaProcessingReview: result.lowConfidence ? { status: "blocked", reason: "LOW_CONFIDENCE_ASR" } : { status: "ready", provider: result.provider, modelVersion: result.modelVersion } },
      contentHash: calculateVideoCandidateContentHash(nextDraft),
      title: nextDraft.title,
      updatedAt: new Date(),
    });
    const prepared = await prepareVideoCandidateForReview(repository, updated.id);
    return { id: candidate.id, status: prepared.status, segments: nextDraft.segments.length };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.env.MEDIA_TRANSCRIPT_CANDIDATE_CONFIRM !== CONFIRMATION) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  if (!process.env.MINIMAX_API_KEY?.trim()) throw new Error("MINIMAX_API_KEY_REQUIRED");
  const limit = Math.min(50, Math.max(1, Number(arg("--limit") ?? process.env.MEDIA_TRANSCRIPT_VIDEO_LIMIT ?? 10)));
  const onlyId = arg("--candidate-id");
  assertConfiguredNumber(MAX_SOURCE_BYTES, "MEDIA_TRANSCRIPT_MAX_SOURCE_BYTES", 1);
  assertConfiguredNumber(COMMAND_TIMEOUT_MS, "MEDIA_VIDEO_COMMAND_TIMEOUT_MS", 30_000);
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    if (!repository.findSourceById) throw new Error("CONTENT_SOURCE_LOOKUP_UNAVAILABLE");
    const initialCandidates = onlyId
      ? [await repository.findCandidateById(onlyId)]
      : await repository.listCandidates({ contentType: "video", status: "review_ready", limit: Math.min(50, limit * 2) });
    const candidates = initialCandidates.filter((candidate): candidate is ContentCandidateRecord => Boolean(candidate))
      .filter((candidate) => candidate.publicationStatus === "draft")
      .filter((candidate) => !onlyId || candidate.id === onlyId)
      .filter((candidate) => candidate.normalizedUrl.startsWith("https://www.youtube.com/watch?v="))
      .filter((candidate) => candidate.rightsStatus === "verified")
      .sort((left, right) => left.lastActivityAt.getTime() - right.lastActivityAt.getTime())
      .slice(0, onlyId ? 1 : limit);
    const results: Array<Readonly<Record<string, unknown>>> = [];
    for (const candidate of candidates) {
      try {
        const source = await repository.findSourceById?.(candidate.sourceId);
        if (!source || source.rightsStatus !== "verified" || !["youtube", "language-reactor"].includes(source.adapterType) || source.sourceKind !== "video-channel") throw new Error("VIDEO_SOURCE_NOT_AUTHORIZED");
        results.push(await processOne(repository, candidate));
      }
      catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
        results.push({ id: candidate.id, status: "failed", error: `${error instanceof Error ? error.message : "MEDIA_VIDEO_TRANSCRIPT_FAILED"}${cause}` });
      }
    }
    const failed = results.filter((result) => result.status === "failed");
    console.log(JSON.stringify({ status: failed.length === 0 ? "succeeded" : results.length > failed.length ? "partial" : "failed", processed: results.length, results }));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await connection.client.end();
  }
}

main().catch((error) => { console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "MEDIA_VIDEO_TRANSCRIPT_FAILED" })); process.exitCode = 1; });
