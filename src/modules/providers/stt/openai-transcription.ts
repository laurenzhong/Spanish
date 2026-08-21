import "server-only";

import { z } from "zod";

import {
  SpeechToTextError,
  type SpeechToTextInput,
  type SpeechToTextProvider,
  type TranscriptResult,
  validateSpeechToTextInput,
} from "./transcription";

const defaultEndpoint = "https://api.openai.com/v1/audio/transcriptions";
const defaultModel = "gpt-transcribe";
const defaultTimeoutMs = 30_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type Clock = () => number;

export type OpenAITranscriptionProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
}>;

type RequestSignal = Readonly<{
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}>;

const transcriptionResponseSchema = z
  .object({
    text: z.string(),
    languages: z
      .array(z.object({ code: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export class OpenAITranscriptionProvider implements SpeechToTextProvider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: OpenAITranscriptionProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.model = options.model ?? defaultModel;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async transcribe(
    input: SpeechToTextInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<TranscriptResult> {
    validateSpeechToTextInput(input);
    if (!this.options.apiKey.trim()) {
      throw new SpeechToTextError(
        "provider-auth-failed",
        "Speech transcription is not configured.",
        false,
      );
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();

    try {
      const form = new FormData();
      const mimeType = input.mimeType.split(";", 1)[0]?.trim() ?? input.mimeType;
      const audioBuffer = new ArrayBuffer(input.audioBytes.byteLength);
      new Uint8Array(audioBuffer).set(input.audioBytes);
      form.append(
        "file",
        new Blob([audioBuffer], { type: mimeType }),
        input.fileName,
      );
      form.append("model", this.model);
      if (input.languageTag) {
        form.append("languages[]", input.languageTag.split("-", 1)[0] ?? input.languageTag);
      }

      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        body: form,
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id");

      if (!response.ok) {
        throw errorForResponseStatus(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new SpeechToTextError(
          "provider-response-invalid",
          "Speech provider returned invalid JSON.",
          false,
        );
      }

      const parsed = parseTranscriptionResponse(payload);
      return {
        text: parsed.text,
        detectedLanguages: parsed.languages
          ?.map((language) =>
            typeof language.code === "string" ? language.code : null,
          )
          .filter((code): code is string => code !== null) ?? [],
        confidence: null,
        confidenceAvailability: "unavailable",
        provider: "openai",
        modelVersion: this.model,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
        retentionPolicy: "ephemeral",
      };
    } catch (error) {
      if (error instanceof SpeechToTextError) throw error;
      if (requestSignal.timedOut()) {
        throw new SpeechToTextError(
          "provider-timeout",
          "Speech transcription timed out.",
          true,
        );
      }
      if (requestSignal.signal.aborted) {
        throw new SpeechToTextError(
          "provider-cancelled",
          "Speech transcription was cancelled.",
          false,
        );
      }
      throw new SpeechToTextError(
        "provider-unavailable",
        "Speech transcription is temporarily unavailable.",
        true,
      );
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createOpenAITranscriptionProvider(
  options: Omit<OpenAITranscriptionProviderOptions, "apiKey"> &
    Partial<Pick<OpenAITranscriptionProviderOptions, "apiKey">> = {},
): OpenAITranscriptionProvider {
  return new OpenAITranscriptionProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY ?? "",
  });
}

function parseTranscriptionResponse(
  payload: unknown,
): z.infer<typeof transcriptionResponseSchema> {
  const parsed = transcriptionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new SpeechToTextError(
      "provider-response-invalid",
      "Speech provider response did not match the expected format.",
      false,
    );
  }

  return parsed.data;
}

function errorForResponseStatus(status: number): SpeechToTextError {
  if (status === 401 || status === 403) {
    return new SpeechToTextError(
      "provider-auth-failed",
      "Speech provider authentication failed.",
      false,
    );
  }
  if (status === 413) {
    return new SpeechToTextError(
      "audio-too-large",
      "Speech provider rejected the audio size.",
      false,
    );
  }
  if (status === 415) {
    return new SpeechToTextError(
      "audio-format-unsupported",
      "Speech provider rejected the audio format.",
      false,
    );
  }
  if (status === 429) {
    return new SpeechToTextError(
      "provider-rate-limited",
      "Speech provider rate limit was reached.",
      true,
    );
  }
  if (status >= 500) {
    return new SpeechToTextError(
      "provider-unavailable",
      "Speech provider is temporarily unavailable.",
      true,
    );
  }
  return new SpeechToTextError(
    "provider-response-invalid",
    "Speech provider rejected the transcription request.",
    false,
  );
}

function createRequestSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestSignal {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();

  if (parentSignal) {
    if (parentSignal.aborted) controller.abort();
    else parentSignal.addEventListener("abort", abort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}
