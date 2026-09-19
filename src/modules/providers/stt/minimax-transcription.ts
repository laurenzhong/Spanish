import "server-only";

import { z } from "zod";
import { groupWordSegments } from "./word-segments";

import {
  SpeechToTextError,
  type SpeechToTextInput,
  type SpeechToTextProvider,
  type TranscriptResult,
  validateSpeechToTextInput,
} from "./transcription";

const defaultEndpoint = "https://api.minimaxi.com/v1/speech_to_text";
const defaultModel = "asr-1.0";
const defaultTimeoutMs = 120_000;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Clock = () => number;

export type MiniMaxTranscriptionProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  timestampLevel?: "sentence" | "word";
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
}>;

const responseSchema = z.object({
  text: z.string().optional(),
  trace_id: z.string().optional(),
  request_id: z.string().optional(),
  duration: z.number().nonnegative().optional(),
  segments: z.array(z.object({
    start: z.number().finite(),
    end: z.number().finite(),
    text: z.string(),
    speaker: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  }).passthrough()).optional(),
}).passthrough();

type RequestSignal = Readonly<{ signal: AbortSignal; timedOut: () => boolean; dispose: () => void }>;

export class MiniMaxTranscriptionProvider implements SpeechToTextProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxTranscriptionProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.model = options.model ?? defaultModel;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async transcribe(input: SpeechToTextInput, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<TranscriptResult> {
    validateSpeechToTextInput(input);
    if (!this.options.apiKey.trim()) throw new SpeechToTextError("provider-auth-failed", "Speech transcription is not configured.", false);

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();
    try {
      const form = new FormData();
      const mimeType = input.mimeType.split(";", 1)[0]?.trim() ?? input.mimeType;
      const audioBuffer = new ArrayBuffer(input.audioBytes.byteLength);
      new Uint8Array(audioBuffer).set(input.audioBytes);
      form.append("file", new Blob([audioBuffer], { type: mimeType }), input.fileName);
      form.append("model", this.model);
      form.append("response_format", "verbose_json");
      form.append("timestamp_level", this.options.timestampLevel ?? "sentence");
      form.append("stream", "false");

      const language = input.languageTag?.split("-", 1)[0]?.trim();
      const headers: Record<string, string> = { Authorization: `Bearer ${this.options.apiKey}` };
      if (language) headers.language = language;
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers,
        body: form,
        signal: requestSignal.signal,
      });
      const headerRequestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
      if (!response.ok) {
        if (response.status === 429) {
          throw new SpeechToTextError("provider-rate-limited", "Speech provider rate limit was reached.", true);
        }
        throw errorForResponseStatus(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SpeechToTextError("provider-response-invalid", "Speech provider returned invalid JSON.", false);
      }
      const parsed = parseResponse(payload);
      const segments = parsed.segments?.map((segment) => ({
        startMs: Math.round(segment.start * 1_000),
        endMs: Math.round(segment.end * 1_000),
        text: segment.text.trim(),
        speaker: segment.speaker ?? null,
        confidence: segment.confidence ?? null,
      })).filter((segment) => segment.text.length > 0) ?? [];
      const text = (parsed.text?.trim() || segments.map((segment) => segment.text).join(" ").trim());
      if (!text) throw new SpeechToTextError("provider-response-invalid", "Speech provider returned empty text.", false);
      return {
        text,
        detectedLanguages: language ? [language] : [],
        confidence: null,
        confidenceAvailability: "unavailable",
        provider: "minimax",
        modelVersion: this.model,
        providerRequestId: headerRequestId ?? parsed.trace_id ?? parsed.request_id ?? null,
        segments: segments.length > 0 ? (this.options.timestampLevel === "word" ? groupWordSegments(segments) : segments) : undefined,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
        retentionPolicy: "ephemeral",
      };
    } catch (error) {
      if (error instanceof SpeechToTextError) throw error;
      if (requestSignal.timedOut()) throw new SpeechToTextError("provider-timeout", "Speech transcription timed out.", true);
      if (requestSignal.signal.aborted) throw new SpeechToTextError("provider-cancelled", "Speech transcription was cancelled.", false);
      throw new SpeechToTextError("provider-unavailable", "Speech transcription is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createMiniMaxTranscriptionProvider(options: Omit<MiniMaxTranscriptionProviderOptions, "apiKey"> & Partial<Pick<MiniMaxTranscriptionProviderOptions, "apiKey">> = {}): MiniMaxTranscriptionProvider {
  return new MiniMaxTranscriptionProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? (process.env.MINIMAX_TRANSCRIPTION_API_ENDPOINT?.trim() || defaultEndpoint),
  });
}

function parseResponse(payload: unknown): z.infer<typeof responseSchema> {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new SpeechToTextError("provider-response-invalid", "Speech provider response did not match the expected format.", false);
  if (parsed.data.segments?.some((segment) => segment.end <= segment.start)) throw new SpeechToTextError("provider-response-invalid", "Speech provider returned an invalid timestamp timeline.", false);
  return parsed.data;
}

function errorForResponseStatus(status: number): SpeechToTextError {
  if (status === 401 || status === 403) return new SpeechToTextError("provider-auth-failed", "Speech provider authentication failed.", false);
  if (status === 413) return new SpeechToTextError("audio-too-large", "Speech provider rejected the audio size.", false);
  if (status === 415) return new SpeechToTextError("audio-format-unsupported", "Speech provider rejected the audio format.", false);
  if (status === 429) return new SpeechToTextError("provider-rate-limited", "Speech provider rate limit was reached.", true);
  if (status >= 500) return new SpeechToTextError("provider-unavailable", "Speech provider is temporarily unavailable.", true);
  return new SpeechToTextError("provider-response-invalid", "Speech provider rejected the transcription request.", false);
}

function createRequestSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): RequestSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => { didTimeout = true; controller.abort(); }, timeoutMs);
  const abort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => { clearTimeout(timeout); parentSignal?.removeEventListener("abort", abort); },
  };
}
