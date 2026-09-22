import { createHash } from "node:crypto";

import { z } from "zod";

import type { PodcastCandidateDraft, VideoCandidateDraft } from "../normalizers";
import { parseProviderJsonCandidates } from "./parse-provider-json";

export const mediaReviewDecisions = ["approved", "changes_requested", "rejected"] as const;
export type MediaReviewDecision = (typeof mediaReviewDecisions)[number];
export type MediaReviewDimension = "content-es-ES" | "teaching-zh-CN";
export type MediaCandidateDraft = VideoCandidateDraft | PodcastCandidateDraft;

export const mediaReviewResultSchema = z.strictObject({
  decision: z.enum(mediaReviewDecisions),
  notes: z.string().trim().max(4_000),
  modelVersion: z.string().trim().min(1).max(160),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type MediaReviewInput = Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentHash: string;
  contentType: "video" | "podcast";
  title: string;
  summary: string;
  draft: MediaCandidateDraft;
}>;

export type MediaReviewResult = z.infer<typeof mediaReviewResultSchema>;

export interface MediaReviewProvider {
  readonly dimension: MediaReviewDimension;
  review(input: MediaReviewInput): Promise<MediaReviewResult>;
}

export function mediaReviewInputHash(input: MediaReviewInput): string {
  return createHash("sha256").update(JSON.stringify({
    candidateId: input.candidateId,
    candidateRevision: input.candidateRevision,
    contentHash: input.contentHash,
    contentType: input.contentType,
    title: input.title,
    summary: input.summary,
    draft: input.draft,
  })).digest("hex");
}

type MiniMaxMediaReviewProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}>;

const defaultMiniMaxEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultMiniMaxModel = "MiniMax-M3";
const anthropicResponseSchema = z.object({
  // MiniMax may add provider-specific fields to text blocks. Only the text
  // payload is part of our contract.
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).passthrough()).min(1),
}).passthrough();
const providerPayloadSchema = z.object({
  decision: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
    if (normalized === "approve" || normalized === "approved") return "approved";
    if (normalized === "changes_requested" || normalized === "request_changes" || normalized === "needs_changes") return "changes_requested";
    if (normalized === "reject" || normalized === "rejected") return "rejected";
    return value;
  }, z.enum(mediaReviewDecisions)),
  // Provider explanations can exceed the persisted review-note limit. Validate
  // the decision and text first, then trim notes at the storage boundary.
  notes: z.string().trim(),
});

function providerStatusError(status: number): Error {
  if (status === 401 || status === 403) return new Error("MEDIA_REVIEW_PROVIDER_AUTH_FAILED");
  if (status === 429) return new Error("MEDIA_REVIEW_PROVIDER_RATE_LIMITED");
  if (status >= 500) return new Error("MEDIA_REVIEW_PROVIDER_UNAVAILABLE");
  return new Error("MEDIA_REVIEW_PROVIDER_RESPONSE_INVALID");
}

function systemPrompt(dimension: MediaReviewDimension): string {
  if (dimension === "content-es-ES") {
    return [
      "You are the Spanish content review gate for a licensed Spanish learning video or podcast.",
      "Review only the supplied immutable metadata and transcript/caption segments; do not claim to have listened to media that was not supplied.",
      "Check title and summary alignment, Spanish naturalness, transcript coherence when present, and that the source metadata does not invent facts.",
      "A missing caption or transcript is an explicitly supported state in this workflow. Do not reject or request changes solely because captions are unavailable; review the supplied title, summary, and metadata honestly.",
      "Return JSON only: {decision: approved|changes_requested|rejected, notes: string}.",
    ].join(" ");
  }
  return [
    "You are the Chinese teaching review gate for a Spanish learning video or podcast.",
    "Review only the supplied immutable metadata and transcript/caption segments.",
      "Check whether the declared A2-B1 CEFR level, summary, transcript availability, and learning value are honest and usable; unavailable captions are acceptable when explicitly marked.",
      "When captions or a transcript are unavailable, do not reject solely for that reason. The unified media workbench can disclose the limitation; assess whether the supplied metadata is still useful and honest.",
    "Do not invent translations, learner evidence, rights, or media contents.",
    "Return JSON only: {decision: approved|changes_requested|rejected, notes: string}.",
  ].join(" ");
}

export class MiniMaxMediaReviewProvider implements MediaReviewProvider {
  readonly dimension: MediaReviewDimension;
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(dimension: MediaReviewDimension, private readonly options: MiniMaxMediaReviewProviderOptions) {
    this.dimension = dimension;
    this.endpoint = options.endpoint ?? defaultMiniMaxEndpoint;
    this.modelVersion = `${options.modelVersion ?? defaultMiniMaxModel}/${dimension}`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async review(input: MediaReviewInput): Promise<MediaReviewResult> {
    if (!this.options.apiKey.trim()) throw new Error("MEDIA_REVIEW_MINIMAX_NOT_CONFIGURED");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          model: this.options.modelVersion ?? defaultMiniMaxModel,
          max_tokens: 700,
          thinking: { type: "disabled" },
          stream: false,
          system: systemPrompt(this.dimension),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({
            candidateId: input.candidateId,
            candidateRevision: input.candidateRevision,
            contentHash: input.contentHash,
            contentType: input.contentType,
            title: input.title,
            summary: input.summary,
            draft: input.draft,
          }) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw providerStatusError(response.status);
      const envelope = anthropicResponseSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) throw new Error("MEDIA_REVIEW_PROVIDER_RESPONSE_INVALID");
      const text = envelope.data.content.map((block) => block.text).join("\n");
      for (const candidate of parseProviderJsonCandidates(text)) {
        const payload = providerPayloadSchema.safeParse(candidate);
        if (payload.success) {
          return {
            decision: payload.data.decision,
            notes: payload.data.notes.trim().slice(0, 4_000),
            modelVersion: this.modelVersion,
            inputHash: mediaReviewInputHash(input),
          };
        }
      }
      throw new Error("MEDIA_REVIEW_PROVIDER_RESPONSE_INVALID");
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MEDIA_REVIEW_")) throw error;
      if (timedOut) throw new Error("MEDIA_REVIEW_PROVIDER_TIMEOUT");
      if (controller.signal.aborted) throw new Error("MEDIA_REVIEW_PROVIDER_CANCELLED");
      throw new Error("MEDIA_REVIEW_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class FakeMediaReviewProvider implements MediaReviewProvider {
  constructor(public readonly dimension: MediaReviewDimension, private readonly modelVersion = `fake-media-review-${dimension}-v1`) {}

  async review(input: MediaReviewInput): Promise<MediaReviewResult> {
    return {
      decision: input.title.trim() && input.summary.trim() ? "approved" : "changes_requested",
      notes: input.title.trim() && input.summary.trim() ? "Fixture media review passed." : "Media title or summary is empty.",
      modelVersion: this.modelVersion,
      inputHash: mediaReviewInputHash(input),
    };
  }
}

export function createConfiguredMediaReviewProviders(options: Readonly<{ provider?: "minimax" | "fake"; apiKey?: string; endpoint?: string; modelVersion?: string; fetchImplementation?: typeof fetch }> = {}) {
  const provider = options.provider ?? (process.env.CONTENT_MEDIA_REVIEW_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax";
  if (provider === "fake") {
    if (process.env.NODE_ENV === "production" || process.env.CONTENT_MEDIA_ALLOW_FAKE_REVIEW !== "1") throw new Error("MEDIA_REVIEW_FAKE_PROVIDER_NOT_ALLOWED");
    return { content: new FakeMediaReviewProvider("content-es-ES"), teaching: new FakeMediaReviewProvider("teaching-zh-CN") };
  }
  if (provider !== "minimax") throw new Error("MEDIA_REVIEW_PROVIDER_UNSUPPORTED");
  const apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
  if (!apiKey.trim()) throw new Error("MEDIA_REVIEW_MINIMAX_NOT_CONFIGURED");
  const common = { apiKey, endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultMiniMaxEndpoint, modelVersion: options.modelVersion ?? process.env.CONTENT_MEDIA_REVIEW_MODEL ?? defaultMiniMaxModel, fetchImplementation: options.fetchImplementation };
  return { content: new MiniMaxMediaReviewProvider("content-es-ES", common), teaching: new MiniMaxMediaReviewProvider("teaching-zh-CN", common) };
}
