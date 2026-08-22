import "server-only";

import { z } from "zod";

import {
  AnnotationDraftError,
  type AnnotationDraft,
  type AnnotationDraftInput,
  type AnnotationDraftProvider,
  validateAnnotationDraftInput,
} from "./annotation";

const defaultEndpoint = "https://api.minimax.io/anthropic/v1/messages";
const defaultModelVersion = "MiniMax-M3";
const defaultTimeoutMs = 30_000;

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type Clock = () => number;

export type MiniMaxAnnotationDraftProviderOptions = Readonly<{
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

const observationSchema = z.object({
  category: z.enum(["transcript", "pronunciation", "fluency", "context"]),
  observation: z.string().trim().min(1),
  evidenceBasis: z.enum(["transcript", "speech-signal", "both"]),
  needsHumanReview: z.literal(true),
}).strict();

const draftPayloadSchema = z.object({
  summary: z.string().trim().min(1),
  observations: z.array(observationSchema).max(12),
  questionsForReviewer: z.array(z.string().trim().min(1)).max(12),
}).strict();

const anthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()),
}).passthrough();

export class MiniMaxAnnotationDraftProvider implements AnnotationDraftProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;
  private readonly clock: Clock;

  constructor(private readonly options: MiniMaxAnnotationDraftProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModelVersion;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async createDraft(
    input: AnnotationDraftInput,
    options: Readonly<{ signal?: AbortSignal }> = {},
  ): Promise<AnnotationDraft> {
    validateAnnotationDraftInput(input);
    if (!this.options.apiKey.trim()) {
      throw new AnnotationDraftError(
        "provider-auth-failed",
        "Annotation drafting is not configured.",
        false,
      );
    }

    const requestSignal = createRequestSignal(options.signal, this.timeoutMs);
    const startedAt = this.clock();

    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 900,
          thinking: { type: "disabled" },
          system: systemPrompt,
          messages: [{ role: "user", content: [{ type: "text", text: buildPrompt(input) }] }],
        }),
        signal: requestSignal.signal,
      });
      const providerRequestId = response.headers.get("x-request-id");

      if (!response.ok) throw errorForResponseStatus(response.status);

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse();
      }

      const parsedResponse = anthropicResponseSchema.safeParse(payload);
      if (!parsedResponse.success || parsedResponse.data.content.length === 0) {
        throw invalidResponse();
      }
      const text = parsedResponse.data.content.map((block) => block.text).join("\n");
      const draft = parseDraftPayload(text);

      return {
        status: "draft",
        ...draft,
        safety: {
          audioSent: false,
          writesEvidence: false,
          affectsMastery: false,
          affectsConfidence: false,
        },
        provider: "minimax",
        modelVersion: this.modelVersion,
        providerRequestId,
        latencyMs: Math.max(0, this.clock() - startedAt),
        estimatedCostMicros: null,
        retentionPolicy: "ephemeral",
      };
    } catch (error) {
      if (error instanceof AnnotationDraftError) throw error;
      if (requestSignal.timedOut()) {
        throw new AnnotationDraftError("provider-timeout", "Annotation drafting timed out.", true);
      }
      if (requestSignal.signal.aborted) {
        throw new AnnotationDraftError("provider-cancelled", "Annotation drafting was cancelled.", false);
      }
      throw new AnnotationDraftError("provider-unavailable", "Annotation provider is temporarily unavailable.", true);
    } finally {
      requestSignal.dispose();
    }
  }
}

export function createMiniMaxAnnotationDraftProvider(
  options: Omit<MiniMaxAnnotationDraftProviderOptions, "apiKey"> &
    Partial<Pick<MiniMaxAnnotationDraftProviderOptions, "apiKey">> = {},
): MiniMaxAnnotationDraftProvider {
  return new MiniMaxAnnotationDraftProvider({
    ...options,
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
  });
}

const systemPrompt = [
  "You prepare a Spanish-learning annotation draft for a human reviewer.",
  "Use only the supplied transcript and aggregate speech-signal observations.",
  "Do not infer phoneme accuracy, learner ability, mastery, confidence, or negative evidence.",
  "Every observation must be phrased as a tentative human-review question or clue.",
  "Return JSON only with summary, observations, and questionsForReviewer.",
].join(" ");

function buildPrompt(input: AnnotationDraftInput): string {
  return JSON.stringify({
    task: "draft_annotation",
    locale: input.locale,
    contentVersion: input.contentVersion,
    attemptId: input.attemptId,
    generationId: input.generationId,
    transcript: input.transcript,
    speechSignal: input.speechSignal,
    constraints: {
      originalAudioIncluded: false,
      writeEvidence: false,
      updateMastery: false,
      updateConfidence: false,
      humanReviewRequired: true,
    },
  });
}

function parseDraftPayload(text: string): z.infer<typeof draftPayloadSchema> {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw invalidResponse();
  }
  const parsed = draftPayloadSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse();
  return parsed.data;
}

function invalidResponse(): AnnotationDraftError {
  return new AnnotationDraftError(
    "provider-response-invalid",
    "Annotation provider response did not match the expected format.",
    false,
  );
}

function errorForResponseStatus(status: number): AnnotationDraftError {
  if (status === 401 || status === 403) return new AnnotationDraftError("provider-auth-failed", "Annotation provider authentication failed.", false);
  if (status === 429) return new AnnotationDraftError("provider-rate-limited", "Annotation provider rate limit was reached.", true);
  if (status >= 500) return new AnnotationDraftError("provider-unavailable", "Annotation provider is temporarily unavailable.", true);
  return invalidResponse();
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
    dispose: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", abort);
    },
  };
}

