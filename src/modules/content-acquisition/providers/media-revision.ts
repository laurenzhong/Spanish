import { z } from "zod";

import {
  calculatePodcastCandidateContentHash,
  calculateVideoCandidateContentHash,
  podcastCandidateDraftSchema,
  videoCandidateDraftSchema,
  type PodcastCandidateDraft,
  type VideoCandidateDraft,
} from "../normalizers";
import { parseProviderJsonCandidates } from "./parse-provider-json";

export type MediaRevisionInput = Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentType: "video" | "podcast";
  draft: VideoCandidateDraft | PodcastCandidateDraft;
  feedback: readonly Readonly<{ dimension: "content-es-ES" | "teaching-zh-CN" | "structure"; notes: string | null }>[];
}>;

const revisionPayloadSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  summary: z.string().trim().max(4_000).optional(),
  cefr: z.preprocess((value) => value === "A2" || value === "B1" ? value : undefined, z.enum(["A2", "B1"]).optional()),
  topics: z.array(z.string().trim().min(1).max(160)).min(1).max(20).optional(),
  region: z.string().trim().min(2).max(35).nullable().optional(),
  changeReason: z.string().trim().min(1).max(1_000).optional(),
}).refine((value) => Object.keys(value).length > 0, "Revision response must change at least one field.");

export type MediaRevisionPayload = z.infer<typeof revisionPayloadSchema>;

export type MediaRevisionProvider = Readonly<{
  revise(input: MediaRevisionInput): Promise<MediaRevisionPayload>;
}>;

type ProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}>;

const defaultEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultModel = "MiniMax-M3";
const responseSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1),
}).passthrough();

export class MiniMaxMediaRevisionProvider implements MediaRevisionProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxAttempts = 2;

  constructor(private readonly options: ProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModel;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async revise(input: MediaRevisionInput): Promise<MediaRevisionPayload> {
    if (!this.options.apiKey.trim()) throw new Error("MEDIA_REVISION_MINIMAX_NOT_CONFIGURED");
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": this.options.apiKey },
        body: JSON.stringify({
          model: this.modelVersion,
          max_tokens: 1_500,
          thinking: { type: "disabled" },
          stream: false,
          system: [
            "You are an editorial revision assistant for a licensed Spanish learning video or podcast.",
            "Return JSON only with mutable fields: title, summary, cefr, topics, region, changeReason.",
            "Use only the supplied metadata and review feedback. Do not invent facts, rights, dates, playback URLs, transcripts, or citations.",
            "Replace promotional link dumps with a short factual Spanish learner-oriented summary when the supplied title and metadata support it.",
            "Keep the content Spanish and keep CEFR within A2-B1. If the current A2 label is not honest, use B1; do not invent a transcript.",
            "Do not modify stableKey, platform IDs, canonical URLs, enclosure URLs, hashes, license fields, copyright fields, or segment data.",
            ...(attempt > 1 ? ["This is a format retry. Return exactly one JSON object with at least one mutable field and no markdown, prose, or nested wrapper."] : []),
          ].join(" "),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(input) }] }],
        }),
        signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 429) throw new Error("MEDIA_REVISION_PROVIDER_RATE_LIMITED");
          if (response.status === 401 || response.status === 403) throw new Error("MEDIA_REVISION_PROVIDER_AUTH_FAILED");
          throw new Error("MEDIA_REVISION_PROVIDER_UNAVAILABLE");
        }
        const envelope = responseSchema.safeParse(await response.json().catch(() => null));
        if (!envelope.success) throw new Error("MEDIA_REVISION_PROVIDER_RESPONSE_INVALID");
        const payload = envelope.data.content.map((block) => block.text).join("\n");
        const invalidPaths = new Set<string>();
        for (const candidate of parseProviderJsonCandidates(payload)) {
          const parsed = revisionPayloadSchema.safeParse(candidate);
          if (parsed.success) return parsed.data;
          for (const issue of parsed.error.issues) invalidPaths.add(issue.path.join(".") || "root");
        }
        throw new Error(`MEDIA_REVISION_PROVIDER_RESPONSE_INVALID:${[...invalidPaths].slice(0, 8).join(",") || "no-json-object"}`);
      } catch (error) {
        const normalized = error instanceof Error && error.message.startsWith("MEDIA_REVISION_")
          ? error
          : controller.signal.aborted
            ? new Error("MEDIA_REVISION_PROVIDER_TIMEOUT")
            : new Error("MEDIA_REVISION_PROVIDER_UNAVAILABLE");
        lastError = normalized;
        const retryable = normalized.message.startsWith("MEDIA_REVISION_PROVIDER_RESPONSE_INVALID")
          || ["MEDIA_REVISION_PROVIDER_UNAVAILABLE", "MEDIA_REVISION_PROVIDER_TIMEOUT"].includes(normalized.message);
        if (!retryable || attempt === this.maxAttempts) throw normalized;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error("MEDIA_REVISION_PROVIDER_UNAVAILABLE");
  }
}

export class FakeMediaRevisionProvider implements MediaRevisionProvider {
  async revise(input: MediaRevisionInput): Promise<MediaRevisionPayload> {
    return {
      summary: input.draft.summary,
      cefr: input.draft.cefr,
      topics: input.draft.topics,
      region: input.draft.region,
      changeReason: `Fixture media revision for ${input.feedback.length} review finding(s).`,
    };
  }
}

export function mergeMediaRevision(
  draft: VideoCandidateDraft | PodcastCandidateDraft,
  payload: MediaRevisionPayload,
): VideoCandidateDraft | PodcastCandidateDraft {
  const next = { ...draft, ...payload, changeReason: payload.changeReason ?? draft.changeReason };
  if ("platform" in draft) {
    const parsed = videoCandidateDraftSchema.parse({ ...next, contentHash: "0".repeat(64) });
    return videoCandidateDraftSchema.parse({ ...parsed, contentHash: calculateVideoCandidateContentHash(parsed) });
  }
  const parsed = podcastCandidateDraftSchema.parse({ ...next, contentHash: "0".repeat(64) });
  return podcastCandidateDraftSchema.parse({ ...parsed, contentHash: calculatePodcastCandidateContentHash(parsed) });
}

export function createConfiguredMediaRevisionProvider(options: Readonly<{
  provider?: "minimax" | "fake";
  apiKey?: string;
  endpoint?: string;
  modelVersion?: string;
  fetchImplementation?: typeof fetch;
}> = {}): MediaRevisionProvider {
  const provider = options.provider ?? (process.env.CONTENT_MEDIA_REVISION_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax";
  if (provider === "fake") {
    if (process.env.NODE_ENV === "production" || process.env.CONTENT_MEDIA_ALLOW_FAKE_REVIEW !== "1") throw new Error("MEDIA_REVISION_FAKE_PROVIDER_NOT_ALLOWED");
    return new FakeMediaRevisionProvider();
  }
  if (provider !== "minimax") throw new Error("MEDIA_REVISION_PROVIDER_UNSUPPORTED");
  const apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
  if (!apiKey.trim()) throw new Error("MEDIA_REVISION_MINIMAX_NOT_CONFIGURED");
  return new MiniMaxMediaRevisionProvider({
    apiKey,
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
    modelVersion: options.modelVersion ?? process.env.CONTENT_MEDIA_REVISION_MODEL ?? defaultModel,
    fetchImplementation: options.fetchImplementation,
  });
}
