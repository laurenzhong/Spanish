import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { createOpenAITranscriptionProvider } from "@/src/modules/providers/stt/server";
import type { SpeechToTextProvider } from "@/src/modules/providers/stt/transcription";
import { createMiniMaxTranslationProvider } from "@/src/modules/providers/translation/server";
import type { TranslationProvider } from "@/src/modules/providers/translation/translation";
import {
  type MediaAsrPolicy,
  type MediaProcessingArtifactStore,
  type MediaTranscriptionEvent,
  type MediaTranscriptionProvider,
  type MediaTranslationProvider,
} from "@/src/modules/media-processing";
import { languageReactorRightsPolicySchema } from "../adapters/language-reactor/language-reactor-adapter";
import { podcastRightsPolicySchema } from "../adapters/podcast/podcast-policy";
import type { ContentCandidateRecord, ContentSourceRecord } from "../repositories";

export class ContentMediaRuntimeError extends Error {
  readonly code = "CONTENT_MEDIA_PROVIDER_NOT_CONFIGURED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContentMediaRuntimeError";
  }
}

type RuntimeTranscriber = MediaTranscriptionProvider & { readonly providerName: string; readonly modelVersion: string };
type RuntimeTranslator = MediaTranslationProvider & { readonly providerName: string; readonly modelVersion: string };

export type ContentMediaRuntime = Readonly<{
  transcriptionProvider: RuntimeTranscriber;
  translationProvider: RuntimeTranslator;
  policy: MediaAsrPolicy;
  createArtifactStore: (candidate: ContentCandidateRecord, source: ContentSourceRecord) => MediaProcessingArtifactStore;
}>;

class SpeechToMediaTranscriptionProvider implements RuntimeTranscriber {
  readonly providerName: string;
  readonly modelVersion: string;

  constructor(private readonly provider: SpeechToTextProvider, identity: Readonly<{ provider: string; modelVersion: string }>) {
    this.providerName = identity.provider;
    this.modelVersion = identity.modelVersion;
  }

  async *transcribe(input: Parameters<MediaTranscriptionProvider["transcribe"]>[0], options?: Readonly<{ signal?: AbortSignal }>): AsyncIterable<MediaTranscriptionEvent> {
    const bytes = new Uint8Array(await readFile(input.assetPath));
    let result;
    try {
      result = await this.provider.transcribe({
        audioBytes: bytes,
        mimeType: mimeTypeForPath(input.assetPath),
        fileName: path.basename(input.assetPath),
        languageTag: input.language,
      }, options);
    } finally {
      bytes.fill(0);
    }
    const text = result.text.trim();
    const segments = splitTranscriptText(text, input.durationMs);
    for (const segment of segments) {
      yield { type: "segment", segment: { ...segment, confidence: result.confidence } };
    }
    yield {
      type: "done",
      providerRequestId: result.providerRequestId,
      modelVersion: result.modelVersion,
      estimatedCostMicros: result.estimatedCostMicros ?? 0,
    };
  }
}

function splitTranscriptText(text: string, durationMs: number): Array<{ startMs: number; endMs: number; text: string }> {
  if (!text) return [];
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]?/gu)?.map((value) => value.trim()).filter(Boolean) ?? [text];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= 1_200) {
      chunks.push(sentence);
      continue;
    }
    for (let offset = 0; offset < sentence.length; offset += 1_200) chunks.push(sentence.slice(offset, offset + 1_200).trim());
  }
  return chunks.map((value, index) => ({
    startMs: Math.floor(index * durationMs / chunks.length),
    endMs: index === chunks.length - 1 ? durationMs : Math.max(1, Math.floor((index + 1) * durationMs / chunks.length)),
    text: value,
  }));
}

class TranslationProviderAdapter implements RuntimeTranslator {
  readonly providerName: string;
  readonly modelVersion: string;

  constructor(private readonly provider: TranslationProvider, identity: Readonly<{ provider: string; modelVersion: string }>) {
    this.providerName = identity.provider;
    this.modelVersion = identity.modelVersion;
  }

  async translate(input: Parameters<MediaTranslationProvider["translate"]>[0], options?: Readonly<{ signal?: AbortSignal }>) {
    const result = await this.provider.translate({ text: input.sourceText, sourceLocale: "es-ES", targetLocale: "zh-CN" }, options);
    return {
      text: result.text,
      providerRequestId: result.providerRequestId,
      modelVersion: result.modelVersion,
      estimatedCostMicros: result.estimatedCostMicros ?? 0,
    };
  }
}

class FakeDurationTranscriber implements RuntimeTranscriber {
  readonly providerName = "fake";
  readonly modelVersion = "fake-media-v1";

  async *transcribe(input: Parameters<MediaTranscriptionProvider["transcribe"]>[0]): AsyncIterable<MediaTranscriptionEvent> {
    yield { type: "segment", segment: { startMs: 0, endMs: input.durationMs, text: "Hola, ¿qué tal?", confidence: 1 } };
    yield { type: "done", providerRequestId: null, modelVersion: this.modelVersion, estimatedCostMicros: 0 };
  }
}

class FixedTranslationProvider implements TranslationProvider {
  async translate() {
    return { text: "你好。", provider: "fake" as const, modelVersion: "fake-media-v1", providerRequestId: null, latencyMs: 0, estimatedCostMicros: 0 };
  }
}

class FakeMediaArtifactStore implements MediaProcessingArtifactStore {
  async acquire(input: Readonly<{ candidateId: string }>) {
    const directory = await mkdtemp(path.join(tmpdir(), "sueno-media-processing-fake-"));
    const outputPath = path.join(directory, "audio.mp3");
    await writeFile(outputPath, new TextEncoder().encode(`fake-audio:${input.candidateId}`));
    return { id: directory, path: outputPath, byteSize: (await stat(outputPath)).size };
  }

  async delete(artifactId: string): Promise<void> {
    await rm(artifactId, { recursive: true, force: true });
  }
}

class BoundedMediaArtifactStore implements MediaProcessingArtifactStore {
  constructor(private readonly candidate: ContentCandidateRecord, private readonly source: ContentSourceRecord) {}

  async acquire(input: Readonly<{ candidateId: string; sourceUrl: string; maxBytes: number }>, options: Readonly<{ signal?: AbortSignal }> = {}) {
    const directory = await mkdtemp(path.join(tmpdir(), "sueno-media-processing-"));
    try {
      const outputPath = this.candidate.contentType === "video"
        ? await downloadAuthorizedYouTubeAudio(input.sourceUrl, directory, input.maxBytes, options.signal, this.source)
        : await downloadAuthorizedAudio(input.sourceUrl, directory, input.maxBytes, options.signal, this.source);
      const normalizedPath = await normalizeAudioForTranscription(outputPath, directory, options.signal);
      const info = await stat(normalizedPath);
      if (!info.isFile() || info.size <= 0 || info.size > input.maxBytes) throw new Error("MEDIA_AUDIO_SIZE_INVALID");
      return { id: directory, path: normalizedPath, byteSize: info.size };
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async delete(artifactId: string): Promise<void> {
    await rm(artifactId, { recursive: true, force: true });
  }
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".m4a" || extension === ".mp4") return "audio/mp4";
  if (extension === ".webm") return "audio/webm";
  if (extension === ".ogg") return "audio/ogg";
  if (extension === ".aac") return "audio/aac";
  if (extension === ".wav") return "audio/wav";
  return "audio/mpeg";
}

async function normalizeAudioForTranscription(inputPath: string, directory: string, signal: AbortSignal | undefined): Promise<string> {
  const extension = path.extname(inputPath).toLowerCase();
  if (extension !== ".ogg" && extension !== ".aac") return inputPath;
  const outputPath = path.join(directory, "normalized.wav");
  await runCommand(process.env.FFMPEG_BIN?.trim() || "ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath,
  ], signal, 10 * 60_000);
  return outputPath;
}

function allowedAudioHosts(source: ContentSourceRecord): readonly string[] {
  if (source.adapterType === "language-reactor") {
    const policy = languageReactorRightsPolicySchema.parse(source.rightsPolicy ?? {});
    return policy.allowedAudioHosts;
  }
  if (source.adapterType === "podcast-rss") {
    const policy = podcastRightsPolicySchema.parse(source.rightsPolicy ?? {});
    return policy.allowedAudioHosts;
  }
  return [];
}

async function downloadAuthorizedAudio(url: string, directory: string, maxBytes: number, signal: AbortSignal | undefined, source: ContentSourceRecord): Promise<string> {
  const allowedHosts = new Set(allowedAudioHosts(source).map((host) => host.toLowerCase()));
  const allowedMimeTypes = source.adapterType === "language-reactor"
    ? languageReactorRightsPolicySchema.parse(source.rightsPolicy ?? {}).allowedAudioMimeTypes
    : podcastRightsPolicySchema.parse(source.rightsPolicy ?? {}).allowedAudioMimeTypes;
  let current = new URL(url);
  if (current.protocol !== "https:" || !allowedHosts.has(current.hostname.toLowerCase())) throw new Error("MEDIA_AUDIO_HOST_NOT_ALLOWLISTED");
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (signal?.aborted) throw new Error("MEDIA_AUDIO_CANCELLED");
    response = await fetch(current, { method: "GET", redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("MEDIA_AUDIO_REDIRECT_INVALID");
      current = new URL(location, current);
      if (current.protocol !== "https:" || !allowedHosts.has(current.hostname.toLowerCase())) throw new Error("MEDIA_AUDIO_REDIRECT_NOT_ALLOWLISTED");
      continue;
    }
    break;
  }
  if (!response?.ok || !response.body) throw new Error("MEDIA_AUDIO_REQUEST_FAILED");
  const declared = Number(response.headers.get("content-length"));
  if (Number.isSafeInteger(declared) && declared > maxBytes) throw new Error("MEDIA_AUDIO_SIZE_INVALID");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!allowedMimeTypes.includes(contentType as never)) throw new Error("MEDIA_AUDIO_CONTENT_TYPE_UNSUPPORTED");
  if (!response.body) throw new Error("MEDIA_AUDIO_REQUEST_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("MEDIA_AUDIO_SIZE_INVALID");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) throw new Error("MEDIA_AUDIO_SIZE_INVALID");
  const extension = contentType === "audio/mp4" ? ".m4a" : contentType === "audio/webm" ? ".webm" : contentType === "audio/ogg" || contentType === "application/ogg" ? ".ogg" : contentType === "audio/aac" ? ".aac" : ".mp3";
  const outputPath = path.join(directory, `audio${extension}`);
  await writeFile(outputPath, bytes);
  bytes.fill(0);
  return outputPath;
}

async function downloadAuthorizedYouTubeAudio(url: string, directory: string, maxBytes: number, signal: AbortSignal | undefined, source: ContentSourceRecord): Promise<string> {
  if (source.adapterType !== "language-reactor") throw new Error("MEDIA_VIDEO_PROCESSING_NOT_AUTHORIZED");
  const policy = languageReactorRightsPolicySchema.parse(source.rightsPolicy ?? {});
  if (policy.temporaryMediaProcessing !== "yt-dlp") throw new Error("MEDIA_VIDEO_PROCESSING_NOT_AUTHORIZED");
  await runCommand(process.env.YTDLP_BIN?.trim() || "yt-dlp", [
    "--ignore-config", "--no-playlist", "--no-progress", "--no-warnings", "--quiet",
    "--format", "bestaudio/best", "--max-filesize", String(maxBytes), "--output", path.join(directory, "audio.%(ext)s"), url,
  ], signal, 15 * 60_000);
  const names = await readdir(directory);
  const name = names.find((value) => value.startsWith("audio."));
  if (!name) throw new Error("MEDIA_YTDLP_FAILED");
  return path.join(directory, name);
}

function runCommand(command: string, args: readonly string[], signal: AbortSignal | undefined, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: "ignore" });
    let settled = false;
    const timeout = setTimeout(() => { child.kill(); finish(() => reject(new Error("MEDIA_AUDIO_TIMEOUT"))); }, timeoutMs);
    const abort = () => { child.kill(); finish(() => reject(new Error("MEDIA_AUDIO_CANCELLED"))); };
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      operation();
    };
    signal?.addEventListener("abort", abort, { once: true });
    child.once("error", () => finish(() => reject(new Error("MEDIA_AUDIO_COMMAND_UNAVAILABLE"))));
    child.once("close", (code) => finish(() => code === 0 ? resolve() : reject(new Error("MEDIA_AUDIO_COMMAND_FAILED"))));
  });
}

export function createContentMediaRuntime(environment: NodeJS.ProcessEnv = process.env): ContentMediaRuntime {
  const mode = environment.CONTENT_MEDIA_PROVIDER_MODE?.trim().toLowerCase();
  if (mode === "fake") {
    return {
      transcriptionProvider: new FakeDurationTranscriber(),
      translationProvider: new TranslationProviderAdapter(new FixedTranslationProvider(), { provider: "fake", modelVersion: "fake-media-v1" }),
      policy: { maxDurationMs: 30 * 60_000, maxAssetBytes: 25 * 1024 * 1024, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 },
      createArtifactStore: () => new FakeMediaArtifactStore(),
    };
  }
  if (mode !== "live") throw new ContentMediaRuntimeError("CONTENT_MEDIA_PROVIDER_MODE must explicitly be fake or live.");
  const sttProvider = environment.CONTENT_MEDIA_STT_PROVIDER?.trim().toLowerCase() || "openai";
  const translationProvider = environment.CONTENT_MEDIA_TRANSLATION_PROVIDER?.trim().toLowerCase() || "minimax";
  if (sttProvider !== "openai") throw new ContentMediaRuntimeError("The configured media STT provider is unsupported; use openai.");
  if (translationProvider !== "minimax") throw new ContentMediaRuntimeError("The configured media translation provider is unsupported; use minimax.");
  const openAiKey = environment.OPENAI_API_KEY?.trim();
  const miniMaxKey = environment.MINIMAX_API_KEY?.trim();
  if (!openAiKey) throw new ContentMediaRuntimeError("The configured media STT credential is missing.");
  if (!miniMaxKey) throw new ContentMediaRuntimeError("The configured media translation credential is missing.");
  const transcriptionModel = environment.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-transcribe";
  const translationModel = environment.MINIMAX_TRANSLATION_MODEL?.trim() || "MiniMax-M3";
  return {
    transcriptionProvider: new SpeechToMediaTranscriptionProvider(createOpenAITranscriptionProvider({ apiKey: openAiKey, model: transcriptionModel }), { provider: "openai", modelVersion: transcriptionModel }),
    translationProvider: new TranslationProviderAdapter(createMiniMaxTranslationProvider({ apiKey: miniMaxKey, modelVersion: translationModel }), { provider: "minimax", modelVersion: translationModel }),
    policy: {
      maxDurationMs: Number(environment.CONTENT_MEDIA_ASR_MAX_DURATION_MS ?? 30 * 60_000),
      maxAssetBytes: Number(environment.CONTENT_MEDIA_ASR_MAX_ASSET_BYTES ?? 25 * 1024 * 1024),
      maxEstimatedCostMicros: Number(environment.CONTENT_MEDIA_ASR_MAX_COST_MICROS ?? 2_000_000),
      minimumConfidence: Number(environment.CONTENT_MEDIA_ASR_MIN_CONFIDENCE ?? 0.72),
    },
    createArtifactStore: (candidate, source) => new BoundedMediaArtifactStore(candidate, source),
  };
}
