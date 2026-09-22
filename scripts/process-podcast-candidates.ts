import "dotenv/config";

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createDrizzleContentAcquisitionRepository } from "../src/modules/content-acquisition/repositories/drizzle-content-acquisition-repository";
import { preparePodcastCandidateForReview } from "../src/modules/content-acquisition/application/prepare-podcast-candidate-for-review";
import { processMediaCandidate, type MediaAudioAssetProvider } from "../src/modules/content-acquisition/application/process-media-candidate";
import type { ContentCandidateRecord, ContentSourceRecord } from "../src/modules/content-acquisition/repositories/content-acquisition-repository";
import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";
import { createMiniMaxTranslationProvider } from "../src/modules/providers/translation/minimax-translation";
import { pcmAudioChunks } from "../src/modules/content-acquisition/processors/pcm-audio-chunks";
import { calculatePodcastCandidateContentHash, createPodcastCandidateDraft, podcastCandidateDraftSchema } from "../src/modules/content-acquisition/normalizers/podcast-candidate";
import { validateSegmentTimeline } from "../src/modules/media/domain";
import { alignAuthorizedTranscript, fetchLanguageReactorPodcastTranscript } from "../src/modules/content-acquisition/adapters/language-reactor/authorized-transcript";
import { translateMediaSegments } from "../src/modules/content-acquisition/processors/media-translation-processor";

const MAX_SOURCE_BYTES = Number(process.env.MEDIA_TRANSCRIPT_MAX_SOURCE_BYTES ?? 2 * 1024 * 1024 * 1024);
const MAX_PCM_BYTES = 512 * 1024 * 1024;
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const confirmation = "I_HAVE_AUTHORIZATION";
const LANGUAGE_REACTOR_MEDIA_DOCS_ENDPOINT = "https://api-cdn.dioco.io/base_media_getMediaDocs_5";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertAllowedUrl(raw: string, hosts: readonly string[]): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || !hosts.includes(url.hostname.toLowerCase())) {
    throw new Error("MEDIA_AUDIO_HOST_NOT_ALLOWLISTED");
  }
  return url;
}

async function download(url: URL, hosts: readonly string[], signal: AbortSignal): Promise<Uint8Array> {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(current, { redirect: "manual", signal, headers: { accept: "audio/*" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("MEDIA_AUDIO_REDIRECT_INVALID");
      current = assertAllowedUrl(new URL(location, current).toString(), hosts);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`MEDIA_AUDIO_DOWNLOAD_HTTP_${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_SOURCE_BYTES) throw new Error("MEDIA_AUDIO_SIZE_INVALID");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.byteLength;
      if (total > MAX_SOURCE_BYTES) throw new Error("MEDIA_AUDIO_SIZE_INVALID");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }
  throw new Error("MEDIA_AUDIO_REDIRECT_INVALID");
}

async function transcode(bytes: Uint8Array, signal: AbortSignal): Promise<Uint8Array> {
  const child = spawn(FFMPEG_BIN, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
  const abort = () => child.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    child.stdin.end(Buffer.from(bytes));
    const code = await new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (value) => resolve(value ?? 1));
    });
    if (signal.aborted) throw new Error("MEDIA_AUDIO_DOWNLOAD_CANCELLED");
    if (code !== 0) throw new Error(`MEDIA_AUDIO_TRANSCODE_FAILED${errors.length ? `: ${Buffer.concat(errors).toString("utf8").slice(0, 200)}` : ""}`);
    const pcm = Buffer.concat(output);
    if (!pcm.length || pcm.length > MAX_PCM_BYTES) throw new Error("MEDIA_AUDIO_TRANSCRIBE_SIZE_FAILED");
    return pcm;
  } finally {
    signal.removeEventListener("abort", abort);
    if (!child.killed) child.kill();
  }
}

async function refreshLanguageReactorAudioUrl(docId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(LANGUAGE_REACTOR_MEDIA_DOCS_ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      userEmail: null,
      diocoToken: null,
      translationLang_G: "zh-CN",
      freq95: { min: 0, max: 100_000 },
      lang_G: "es",
      filters: { mediaTab: "TAB_PODCASTS" },
      pinnedDiocoPlaylistIds: [],
      selectedDiocoPlaylistId: "t_pd_mix_es",
      diocoPlaylistId: "t_pd_mix_es",
      forceIncludeDiocoDocId: docId,
      offset: 0,
      limit: 100,
    }),
    signal,
  });
  if (!response.ok) throw new Error("MEDIA_AUDIO_SOURCE_REFRESH_FAILED");
  const body = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
  const match = body.data?.docs_metadata?.find((doc) => doc.diocoDocId?.toLowerCase() === docId.toLowerCase());
  if (!match?.audioFileURL) throw new Error("MEDIA_AUDIO_SOURCE_REFRESH_FAILED");
  return match.audioFileURL;
}

function sourceHosts(source: ContentSourceRecord): string[] {
  const policy = source.rightsPolicy;
  if (!policy || typeof policy !== "object" || !Array.isArray(policy.allowedAudioHosts)) throw new Error("MEDIA_AUDIO_ALLOWLIST_MISSING");
  return policy.allowedAudioHosts.filter((host): host is string => typeof host === "string").map((host) => host.toLowerCase());
}

function candidateInput(candidate: ContentCandidateRecord, draft: ReturnType<typeof podcastCandidateDraftSchema.parse>, durationMs = draft.durationMs) {
  return {
    id: candidate.id,
    contentType: "podcast" as const,
    language: draft.language,
    rightsStatus: candidate.rightsStatus,
    durationMs,
    assetBytes: draft.enclosureByteSize,
    mimeType: draft.enclosureMimeType,
    fileName: `${draft.stableKey}.audio`,
    contentHash: draft.contentHash,
  };
}

async function processOne(repository: ReturnType<typeof createDrizzleContentAcquisitionRepository>, candidate: ContentCandidateRecord, source: ContentSourceRecord): Promise<Readonly<{ id: string; status: string; segments: number }>> {
  const currentDraft = podcastCandidateDraftSchema.parse(candidate.metadata.podcastDraft);
  if (["platform_manual", "platform_auto"].includes(currentDraft.transcriptStatus) && currentDraft.segments.length > 0 && currentDraft.segments.every((segment) => segment.translation && segment.words?.length)) {
    return { id: candidate.id, status: "already-processed", segments: currentDraft.segments.length };
  }
  const hosts = sourceHosts(source);
  const controller = AbortSignal.timeout(Number(process.env.MEDIA_TRANSCRIPT_CANDIDATE_TIMEOUT_MS ?? 15 * 60_000));
  let activeEnclosureUrl = currentDraft.enclosureUrl;
  const downloadAudio = async () => {
    try {
      return await download(assertAllowedUrl(activeEnclosureUrl, hosts), hosts, controller);
    } catch (error) {
      if (source.adapterType !== "language-reactor") throw error;
      activeEnclosureUrl = await refreshLanguageReactorAudioUrl(currentDraft.episodeGuid, controller);
      return download(assertAllowedUrl(activeEnclosureUrl, hosts), hosts, controller);
    }
  };
  let pcm: Uint8Array | null = null;
  let decodedDurationMs = currentDraft.durationMs;
  const audio: MediaAudioAssetProvider = {
    acquire: async () => {
      const sourceBytes = await downloadAudio();
      pcm = await transcode(sourceBytes, controller);
      decodedDurationMs = Math.round(pcm.byteLength / 32);
      const hash = createHash("sha256").update(pcm).digest("hex");
      return { bytes: pcm, mimeType: "audio/wav", fileName: `${currentDraft.stableKey}.wav`, contentHash: hash, preparedChunks: pcmAudioChunks(pcm) };
    },
    release: async () => "deleted",
  };
  const result = await processMediaCandidate({
    candidate: candidateInput(candidate, currentDraft, decodedDurationMs),
    audio,
    transcriptionProvider: createMiniMaxTranscriptionProvider({ timestampLevel: "word" }),
    translationProvider: createMiniMaxTranslationProvider({ timeoutMs: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_TIMEOUT_MS ?? 120_000) }),
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
  if (!pcm || result.segments.length === 0) throw new Error("MEDIA_TRANSCRIPT_EMPTY");
  validateSegmentTimeline(result.segments, decodedDurationMs);
  const authorizedCues = await fetchLanguageReactorPodcastTranscript({ audioUrl: activeEnclosureUrl, docId: currentDraft.episodeGuid, signal: controller });
  const authorizedSegments = alignAuthorizedTranscript(authorizedCues, result.segments, decodedDurationMs, "platform_auto");
  const translated = await translateMediaSegments({
    segments: authorizedSegments,
    provider: createMiniMaxTranslationProvider({ timeoutMs: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_TIMEOUT_MS ?? 120_000) }),
    // Authorized transcript alignment is translated independently from the
    // ASR pass. Serial requests make even short podcast episodes exceed the
    // candidate timeout; cap the worker pool in the shared processor instead.
    concurrency: Number(process.env.MEDIA_TRANSCRIPT_TRANSLATION_CONCURRENCY ?? 4),
    signal: controller,
  });
  if (translated.failedCount > 0 || translated.segments.some((segment) => !segment.translation?.trim())) {
    throw new Error(`MEDIA_AUTHORIZED_TRANSCRIPT_TRANSLATION_INCOMPLETE:${translated.errors.join(",") || "missing-translation"}`);
  }
  const nextDraft = createPodcastCandidateDraft({
    ...currentDraft,
    enclosureUrl: activeEnclosureUrl,
    durationMs: decodedDurationMs,
    transcriptStatus: "platform_auto",
    transcriptUrl: currentDraft.canonicalUrl,
    segments: [...translated.segments],
    changeReason: "Reprocessed from the owner-authorized Language Reactor transcript; MiniMax supplies translations and aligned word timing only.",
  });
  if (nextDraft.contentHash === currentDraft.contentHash) throw new Error("MEDIA_TRANSCRIPT_DRAFT_UNCHANGED");
  const updated = await repository.requestCandidateReprocessing({
    candidateId: candidate.id,
    expectedRevision: candidate.revision,
    generationId: randomUUID(),
    metadata: { ...candidate.metadata, podcastDraft: nextDraft, mediaProcessingReview: result.lowConfidence ? { status: "blocked", reason: "LOW_CONFIDENCE_ASR" } : { status: "ready", provider: result.provider, modelVersion: result.modelVersion } },
    contentHash: calculatePodcastCandidateContentHash(nextDraft),
    title: nextDraft.title,
    updatedAt: new Date(),
  });
  const prepared = await preparePodcastCandidateForReview(repository, updated.id);
  return { id: candidate.id, status: prepared.status, segments: nextDraft.segments.length };
}

async function main() {
  if (process.env.MEDIA_TRANSCRIPT_CANDIDATE_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  if (!process.env.MINIMAX_API_KEY?.trim()) throw new Error("MINIMAX_API_KEY_REQUIRED");
  const limit = Math.min(50, Math.max(1, Number(arg("--limit") ?? process.env.MEDIA_TRANSCRIPT_CANDIDATE_LIMIT ?? 10)));
  const onlyId = arg("--candidate-id");
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    const statuses = ["review_ready", "rejected"] as const;
    const candidates = (await Promise.all(statuses.map((status) => repository.listCandidates({ contentType: "podcast", status, limit })))).flat()
      .filter((candidate) => !onlyId || candidate.id === onlyId)
      .filter((candidate) => candidate.publicationStatus === "draft")
      .sort((left, right) => left.lastActivityAt.getTime() - right.lastActivityAt.getTime())
      .slice(0, onlyId ? 1 : limit);
    const results: Array<Readonly<Record<string, unknown>>> = [];
    for (const candidate of candidates) {
      try {
        const source = await repository.findSourceById?.(candidate.sourceId);
        if (!source || source.rightsStatus !== "verified") throw new Error("RIGHTS_NOT_VERIFIED");
        results.push(await processOne(repository, candidate, source));
      } catch (error) {
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : "";
        results.push({ id: candidate.id, status: "failed", error: `${error instanceof Error ? error.message : "MEDIA_TRANSCRIPT_FAILED"}${cause}` });
      }
    }
    const failed = results.filter((result) => result.status === "failed");
    console.log(JSON.stringify({ status: failed.length === 0 ? "succeeded" : results.length > failed.length ? "partial" : "failed", processed: results.length, results }));
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    await connection.client.end();
  }
}

main().catch((error) => { console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : "MEDIA_TRANSCRIPT_CANDIDATES_FAILED" })); process.exitCode = 1; });
