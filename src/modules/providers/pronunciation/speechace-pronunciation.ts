import "server-only";

import { z } from "zod";

import {
  PronunciationAssessmentError,
  type PronunciationAssessmentInput,
  type PronunciationAssessmentResult,
  type PronunciationProvider,
  validatePronunciationInput,
} from "./pronunciation";

const defaultEndpoint = "https://api.speechace.co/api/scoring/speech/v9/json";
const defaultModelVersion = "speechace-v9";
const defaultTimeoutMs = 30_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type Clock = () => number;

export type SpeechacePronunciationProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
  clock?: Clock;
}>;

type RequestSignal = Readonly<{
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}>;

const scoreSchema = z.number().min(0).max(100);

const speechaceResponseSchema = z
  .object({
    status: z.string().optional(),
    speech_score: z
      .object({
        pronunciation: scoreSchema.nullable().optional(),
        fluency: scoreSchema.nullable().optional(),
      })
      .passthrough(),
    transcript: z.string().optional(),
  })
  .passthrough();

export class SpeechacePronunciationProvider implements PronunciationProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: SpeechacePronunciationProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async assess(
    input: PronunciationAssessmentInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<PronunciationAssessmentResult> {
    validatePronunciationInput(input);
    if (!this.options.apiKey.trim()) {
      throw new PronunciationAssessmentError(
        "provider-auth-failed",
        "Pronunciation assessment is not configured.",
        false,
      );
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();

    try {
      const requestUrl = new URL(this.endpoint);
      requestUrl.searchParams.set("key", this.options.apiKey);
      requestUrl.searchParams.set("dialect", dialectForLocale(input.locale));

      const form = new FormData();
      const mimeType = input.mimeType.split(";", 1)[0]?.trim() ?? input.mimeType;
      const audioBuffer = new ArrayBuffer(input.audioBytes.byteLength);
      new Uint8Array(audioBuffer).set(input.audioBytes);
      form.append(
        "user_audio_file",
        new Blob([audioBuffer], { type: mimeType }),
        input.fileName,
      );
      form.append("question_info", input.attemptId);
      if (input.referenceText?.trim()) {
        form.append("relevance_context", input.referenceText);
      }

      const response = await this.fetchImplementation(requestUrl, {
        method: "POST",
        body: form,
        signal: requestSignal.signal,
      });
      const providerRequestId =
        response.headers.get("x-request-id") ??
        response.headers.get("x-speechace-request-id");

      if (!response.ok) {
        throw errorForResponseStatus(response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PronunciationAssessmentError(
          "provider-response-invalid",
          "Pronunciation provider returned invalid JSON.",
          false,
        );
      }

      const parsed = parseSpeechaceResponse(payload);
      const latencyMs = Math.max(0, this.clock() - startedAt);
      const pronunciation = parsed.speech_score.pronunciation;
      const fluency = parsed.speech_score.fluency;

      if (typeof pronunciation !== "number" || typeof fluency !== "number") {
        return insufficientResult(
          this.modelVersion,
          providerRequestId,
          latencyMs,
        );
      }

      return {
        quality: "usable",
        pronunciationScore: pronunciation / 100,
        fluencyScore: fluency / 100,
        prosodyScore: null,
        completenessScore: null,
        provider: "speechace",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs,
        estimatedCostMicros: null,
        retentionPolicy: "ephemeral",
      };
    } catch (error) {
      if (error instanceof PronunciationAssessmentError) throw error;
      if (requestSignal.timedOut()) {
        throw new PronunciationAssessmentError(
          "provider-timeout",
          "Pronunciation assessment timed out.",
          true,
        );
      }
      if (requestSignal.signal.aborted) {
        throw new PronunciationAssessmentError(
          "provider-cancelled",
          "Pronunciation assessment was cancelled.",
          false,
        );
      }
      throw new PronunciationAssessmentError(
        "provider-unavailable",
        "Pronunciation provider is temporarily unavailable.",
        true,
      );
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createSpeechacePronunciationProvider(
  options: Omit<SpeechacePronunciationProviderOptions, "apiKey"> &
    Partial<Pick<SpeechacePronunciationProviderOptions, "apiKey">> = {},
): SpeechacePronunciationProvider {
  return new SpeechacePronunciationProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.SPEECHACE_API_KEY ?? "",
    endpoint:
      options.endpoint ??
      process.env.SPEECHACE_API_ENDPOINT ??
      defaultEndpoint,
  });
}

function dialectForLocale(locale: PronunciationAssessmentInput["locale"]): string {
  return locale.toLowerCase();
}

function parseSpeechaceResponse(
  payload: unknown,
): z.infer<typeof speechaceResponseSchema> {
  const parsed = speechaceResponseSchema.safeParse(payload);
  if (!parsed.success || (parsed.data.status && parsed.data.status !== "success")) {
    throw new PronunciationAssessmentError(
      "provider-response-invalid",
      "Pronunciation provider response did not match the expected format.",
      false,
    );
  }

  return parsed.data;
}

function insufficientResult(
  modelVersion: string,
  providerRequestId: string | null,
  latencyMs: number,
): PronunciationAssessmentResult {
  return {
    quality: "insufficient",
    pronunciationScore: null,
    fluencyScore: null,
    prosodyScore: null,
    completenessScore: null,
    provider: "speechace",
    modelVersion,
    providerRequestId,
    latencyMs,
    estimatedCostMicros: null,
    retentionPolicy: "ephemeral",
  };
}

function errorForResponseStatus(status: number): PronunciationAssessmentError {
  if (status === 401 || status === 403) {
    return new PronunciationAssessmentError(
      "provider-auth-failed",
      "Pronunciation provider authentication failed.",
      false,
    );
  }
  if (status === 413) {
    return new PronunciationAssessmentError(
      "audio-too-large",
      "Pronunciation provider rejected the audio size.",
      false,
    );
  }
  if (status === 415) {
    return new PronunciationAssessmentError(
      "audio-format-unsupported",
      "Pronunciation provider rejected the audio format.",
      false,
    );
  }
  if (status === 408) {
    return new PronunciationAssessmentError(
      "provider-timeout",
      "Pronunciation provider timed out the request.",
      true,
    );
  }
  if (status === 429) {
    return new PronunciationAssessmentError(
      "provider-rate-limited",
      "Pronunciation provider rate limit was reached.",
      true,
    );
  }
  if (status >= 500) {
    return new PronunciationAssessmentError(
      "provider-unavailable",
      "Pronunciation provider is temporarily unavailable.",
      true,
    );
  }
  return new PronunciationAssessmentError(
    "provider-response-invalid",
    "Pronunciation provider rejected the assessment request.",
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
