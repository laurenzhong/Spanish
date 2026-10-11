import "server-only";

import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { z } from "zod";

import { groupWordSegments } from "./word-segments";
import {
  SpeechToTextError,
  type SpeechToTextInput,
  type SpeechToTextProvider,
  type TranscriptResult,
  validateSpeechToTextInput,
} from "./transcription";

const defaultEndpoint = "https://api.minimax.cn/v1/speech_to_text";
const defaultModel = "asr-1.0";
const defaultTimeoutMs = 10 * 60_000;
const maxRequestDurationMs = 500_000;
const chunkDurationSeconds = 450;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MiniMaxTranscriptionProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  /**
   * `word` asks the provider for one unit per word, which is what a word-aligned
   * timeline needs; `sentence` keeps the default, cheaper response.
   */
  timestampLevel?: "sentence" | "word";
}>;

const responseSchema = z.object({
  text: z.string(),
  duration: z.number().nonnegative().optional(),
  trace_id: z.string().optional(),
  segments: z.array(z.object({
    text: z.string(),
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    speaker: z.string().nullable().optional(),
  }).passthrough()).optional(),
}).passthrough();

/** One provider unit, in milliseconds, before it is grouped into a segment. */
type ProviderUnit = Readonly<{ text: string; startMs: number; endMs: number; speaker: string | null; confidence: null }>;

function providerUnits(segments: NonNullable<z.infer<typeof responseSchema>["segments"]>): ProviderUnit[] {
  return segments.map((segment) => ({
    text: segment.text,
    startMs: Math.round(segment.start * 1_000),
    endMs: Math.round(segment.end * 1_000),
    speaker: segment.speaker ?? null,
    confidence: null,
  }));
}

export class MiniMaxTranscriptionProvider implements SpeechToTextProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(private readonly options: MiniMaxTranscriptionProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.model = options.model ?? defaultModel;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async transcribe(input: SpeechToTextInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<TranscriptResult> {
    validateSpeechToTextInput(input);
    if (!this.options.apiKey.trim()) throw new SpeechToTextError("provider-auth-failed", "Speech transcription is not configured.", false);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const startedAt = Date.now();
    try {
      const wordLevel = this.options.timestampLevel === "word";
      const responses = input.durationMs && input.durationMs > maxRequestDurationMs
        ? await this.transcribeChunks(input, controller.signal)
        : [await this.transcribeBytes(input.audioBytes, input.mimeType, input.fileName, controller.signal)];
      const text = responses.map((result) => result.text.trim()).filter(Boolean).join(" ");
      return {
        text,
        detectedLanguages: [input.languageTag ?? "es"],
        confidence: null,
        confidenceAvailability: "unavailable",
        provider: "minimax",
        modelVersion: this.model,
        providerRequestId: responses.at(-1)?.requestId ?? null,
        latencyMs: Math.max(0, Date.now() - startedAt),
        estimatedCostMicros: null,
        retentionPolicy: "ephemeral",
        ...(wordLevel ? { segments: groupWordSegments(flattenUnits(responses)) } : {}),
      };
    } catch (error) {
      if (error instanceof SpeechToTextError) throw error;
      if (options.signal?.aborted) throw new SpeechToTextError("provider-cancelled", "Speech transcription was cancelled.", false);
      if (timedOut) throw new SpeechToTextError("provider-timeout", "Speech transcription timed out.", true);
      throw new SpeechToTextError("provider-unavailable", "Speech transcription is temporarily unavailable.", true);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private async transcribeChunks(input: SpeechToTextInput, signal: AbortSignal): Promise<readonly MiniMaxResponse[]> {
    if (!input.assetPath?.trim()) {
      throw new SpeechToTextError(
        "audio-invalid",
        "An asset path is required when chunking long audio.",
        false,
      );
    }
    const directory = await mkdtemp(path.join(tmpdir(), "sueno-minimax-asr-"));
    try {
      await runCommand(process.env.FFMPEG_BIN?.trim() || "ffmpeg", [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input.assetPath,
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
        "-f", "segment", "-segment_time", String(chunkDurationSeconds), "-reset_timestamps", "1", path.join(directory, "chunk-%03d.mp3"),
      ], signal, this.timeoutMs);
      const names = (await readdir(directory)).filter((name) => name.endsWith(".mp3")).sort();
      if (names.length === 0) throw new SpeechToTextError("provider-response-invalid", "Speech provider chunking produced no audio.", false);
      const results: MiniMaxResponse[] = [];
      for (const name of names) {
        if (signal.aborted) throw new SpeechToTextError("provider-cancelled", "Speech transcription was cancelled.", false);
        const bytes = await readFile(path.join(directory, name));
        // ffmpeg numbers the parts in order, so the index gives this part's
        // offset inside the asset (see chunkOffsetMs).
        const offsetMs = chunkOffsetMs(name);
        const transcribed = await this.transcribeBytes(new Uint8Array(bytes), "audio/mpeg", name, signal);
        results.push({ ...transcribed, offsetMs });
      }
      return results;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private async transcribeBytes(bytes: Uint8Array, mimeType: string, fileName: string, signal: AbortSignal): Promise<MiniMaxResponse> {
    const audioBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(audioBuffer).set(bytes);
    const form = new FormData();
    form.append("model", this.model);
    form.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    form.append("response_format", "verbose_json");
    form.append("timestamp_level", this.options.timestampLevel ?? "sentence");
    form.append("stream", "false");
    const response = await this.fetchImplementation(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
      signal,
    });
    const requestId = response.headers.get("x-request-id");
    if (!response.ok) throw errorForResponseStatus(response.status);
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new SpeechToTextError("provider-response-invalid", "Speech provider returned invalid JSON.", false); }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new SpeechToTextError("provider-response-invalid", "Speech provider response did not match the expected format.", false);
    const units = this.options.timestampLevel === "word" && parsed.data.segments
      ? providerUnits(parsed.data.segments)
      : undefined;
    if (units?.some((unit) => unit.endMs <= unit.startMs)) {
      throw new SpeechToTextError("provider-response-invalid", "Speech provider returned an invalid timestamp timeline.", false);
    }
    return { text: parsed.data.text, requestId: requestId ?? parsed.data.trace_id ?? null, units };
  }
}

type MiniMaxResponse = Readonly<{
  text: string;
  requestId: string | null;
  /** Word units relative to this request's own audio, when word level was asked for. */
  units?: readonly ProviderUnit[];
  /** Offset of this request's audio inside the source asset; 0 for a single call. */
  offsetMs?: number;
}>;

/**
 * Word units from every chunk, moved onto the source asset's timeline. Providers
 * time each chunk from its own start, so without this every chunk after the first
 * would report word positions relative to the wrong origin.
 */
export function flattenUnits(responses: readonly MiniMaxResponse[]): ProviderUnit[] {
  return responses.flatMap((response) => {
    const offset = response.offsetMs ?? 0;
    return (response.units ?? []).map((unit) => offset === 0 ? unit : {
      ...unit,
      startMs: unit.startMs + offset,
      endMs: unit.endMs + offset,
    });
  });
}

/**
 * Offset of a numbered ffmpeg part inside the source asset. Parts are produced at
 * the configured segment length, so the index gives the offset of that part's own
 * audio; the final part is shorter, which only affects where it ends.
 */
export function chunkOffsetMs(fileName: string): number {
  // Only the numeric part ffmpeg appends before the extension counts; a naive
  // "all digits" read would also pick up the digits of the ".mp3" suffix.
  const part = /-(\d+)\.[a-z0-9]+$/iu.exec(fileName)?.[1];
  if (!part) throw new Error("minimax-chunk-name-invalid");
  return Number(part) * chunkDurationSeconds * 1_000;
}

function runCommand(command: string, args: readonly string[], signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: "ignore" });
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => { child.kill(); finish(() => reject(new SpeechToTextError("provider-cancelled", "Speech transcription was cancelled.", false))); };
    const timeout = setTimeout(() => { child.kill(); finish(() => reject(new SpeechToTextError("provider-timeout", "Speech transcription timed out.", true))); }, timeoutMs);
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    child.once("error", () => finish(() => reject(new SpeechToTextError("provider-unavailable", "Speech transcription command is unavailable.", true))));
    child.once("close", (code) => finish(() => code === 0 ? resolve() : reject(new SpeechToTextError("provider-response-invalid", "Speech transcription chunking failed.", false))));
  });
}

export function createMiniMaxTranscriptionProvider(options: Partial<MiniMaxTranscriptionProviderOptions> = {}): MiniMaxTranscriptionProvider {
  return new MiniMaxTranscriptionProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_TRANSCRIPTION_API_ENDPOINT ?? defaultEndpoint,
    model: options.model ?? process.env.MINIMAX_TRANSCRIPTION_MODEL ?? defaultModel,
  });
}

function errorForResponseStatus(status: number): SpeechToTextError {
  if (status === 401 || status === 403) return new SpeechToTextError("provider-auth-failed", "Speech provider authentication failed.", false);
  if (status === 413) return new SpeechToTextError("audio-too-large", "Speech provider rejected the audio size.", false);
  if (status === 415) return new SpeechToTextError("audio-format-unsupported", "Speech provider rejected the audio format.", false);
  if (status === 429) return new SpeechToTextError("provider-rate-limited", "Speech provider rate limit was reached.", true);
  if (status >= 500) return new SpeechToTextError("provider-unavailable", "Speech provider is temporarily unavailable.", true);
  return new SpeechToTextError("provider-response-invalid", "Speech provider rejected the transcription request.", false);
}
