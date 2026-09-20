import { z } from "zod";

import { articleCandidateContentHash, articleCandidateDraftSchema, type ArticleCandidateDraft } from "../normalizers";
import type { ArticleReviewDecision } from "./article-review";
import { parseProviderJsonCandidates } from "./parse-provider-json";

export type ArticleRevisionInput = Readonly<{
  candidateId: string;
  candidateRevision: number;
  draft: ArticleCandidateDraft;
  feedback: readonly Readonly<{
    dimension: "content-es-ES" | "teaching-zh-CN" | "structure";
    status: ArticleReviewDecision;
    notes: string | null;
  }>[];
}>;

// Models often return only the fields that changed. Optional fields are merged
// with the frozen draft below; immutable rights/source fields never come from it.
const revisionPayloadSchema = z.object({
  stableKey: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(500).optional(),
  summary: z.string().trim().min(1).max(4_000).optional(),
  author: z.string().trim().min(1).max(300).nullable().optional(),
  publicationDate: z.iso.date().nullable().optional(),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).optional(),
  topics: z.array(z.string().trim().min(1).max(160)).min(1).max(30).optional(),
  region: z.string().trim().min(2).max(40).optional(),
  register: z.string().trim().min(2).max(80).optional(),
  format: z.enum(["news", "essay", "dialogue", "guide", "story"]).optional(),
  estimatedReadingMinutes: z.number().int().positive().max(240).optional(),
  oralTransferType: z.preprocess((value) => ["none", "summary", "opinion", "personal_transfer"].includes(value as string) ? value : undefined, z.enum(["none", "summary", "opinion", "personal_transfer"]).optional()),
  paragraphs: z.array(z.string().trim().min(1).max(8_000)).min(1).max(500).optional(),
  changeReason: z.string().trim().min(1).max(2_000).optional(),
}).refine((value) => Object.keys(value).length > 0, "Revision response must change at least one field.");

export type ArticleRevisionPayload = z.infer<typeof revisionPayloadSchema>;

export type ArticleRevisionProvider = Readonly<{
  revise(input: ArticleRevisionInput): Promise<ArticleRevisionPayload>;
}>;

export type MiniMaxArticleRevisionProviderOptions = Readonly<{
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

export class MiniMaxArticleRevisionProvider implements ArticleRevisionProvider {
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly maxAttempts = 2;

  constructor(private readonly options: MiniMaxArticleRevisionProviderOptions) {
    this.endpoint = options.endpoint ?? defaultEndpoint;
    this.modelVersion = options.modelVersion ?? defaultModel;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async revise(input: ArticleRevisionInput): Promise<ArticleRevisionPayload> {
    if (!this.options.apiKey.trim()) throw new Error("ARTICLE_REVISION_MINIMAX_NOT_CONFIGURED");
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": this.options.apiKey,
        },
        body: JSON.stringify({
          model: this.options.modelVersion ?? defaultModel,
          max_tokens: 4_000,
          thinking: { type: "disabled" },
          stream: false,
          system: [
            "You are an editorial revision assistant for a licensed Spanish learning article.",
            "Return JSON only with the exact mutable fields requested.",
            "Apply only corrections supported by the supplied review feedback and article text.",
            "Do not invent facts, citations, rights, authors, dates, or events.",
            "Preserve the source meaning. You may remove navigation noise, repair clear OCR/HTML errors, simplify sentence structure, and adjust CEFR metadata when the review requires it.",
            "The product audience is A2-B1. Do not raise an article above B1. When feedback says the current text is too difficult, return a shorter B1 adaptation with fewer paragraphs, shorter sentences, and only essential facts; set cefr to B1. Do not merely relabel a dense article.",
            "If a safe B1 adaptation cannot preserve the source meaning, keep the original text and omit the cefr field so the review gate can reject it.",
            "Treat every concrete review finding as a checklist: when feedback asks for a missing sentence, glossary, or paragraph correction, return the complete corrected paragraphs rather than changing metadata only.",
            "Before returning changeReason, compare it with the revised summary and paragraphs. Do not claim that an edit was made unless the exact correction is present in the returned fields; remove unsupported claims from changeReason.",
            "Prefer returning summary and paragraphs together when a review identifies a mismatch between them, so the next revision is self-consistent.",
            "Keep the article in Spanish. Do not add explanations outside the JSON.",
            ...(attempt > 1 ? ["This is a format retry. Return exactly one JSON object with at least one mutable field and no markdown, prose, or nested wrapper."] : []),
          ].join(" "),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(input) }] }],
        }),
        signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 429) throw new Error("ARTICLE_REVISION_PROVIDER_RATE_LIMITED");
          if (response.status === 401 || response.status === 403) throw new Error("ARTICLE_REVISION_PROVIDER_AUTH_FAILED");
          throw new Error("ARTICLE_REVISION_PROVIDER_UNAVAILABLE");
        }
        const envelope = responseSchema.safeParse(await response.json().catch(() => null));
        if (!envelope.success) throw new Error("ARTICLE_REVISION_PROVIDER_RESPONSE_INVALID");
        const payload = envelope.data.content.map((block) => block.text).join("\n");
        const invalidPaths = new Set<string>();
        for (const candidate of parseProviderJsonCandidates(payload)) {
          const parsed = revisionPayloadSchema.safeParse(candidate);
          if (parsed.success) return parsed.data;
          for (const issue of parsed.error.issues) invalidPaths.add(issue.path.join(".") || "root");
        }
        throw new Error(`ARTICLE_REVISION_PROVIDER_RESPONSE_INVALID:${[...invalidPaths].slice(0, 8).join(",") || "no-json-object"}`);
      } catch (error) {
        const normalized = error instanceof Error && error.message.startsWith("ARTICLE_REVISION_")
          ? error
          : controller.signal.aborted
            ? new Error("ARTICLE_REVISION_PROVIDER_TIMEOUT")
            : new Error("ARTICLE_REVISION_PROVIDER_UNAVAILABLE");
        lastError = normalized;
        const retryable = normalized.message.startsWith("ARTICLE_REVISION_PROVIDER_RESPONSE_INVALID")
          || ["ARTICLE_REVISION_PROVIDER_UNAVAILABLE", "ARTICLE_REVISION_PROVIDER_TIMEOUT"].includes(normalized.message);
        if (!retryable || attempt === this.maxAttempts) throw normalized;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError ?? new Error("ARTICLE_REVISION_PROVIDER_UNAVAILABLE");
  }
}

export class FakeArticleRevisionProvider implements ArticleRevisionProvider {
  async revise(input: ArticleRevisionInput): Promise<ArticleRevisionPayload> {
    return {
      title: input.draft.title,
      summary: input.draft.summary,
      author: input.draft.author,
      publicationDate: input.draft.publicationDate,
      cefr: input.draft.cefr,
      topics: input.draft.topics,
      region: input.draft.region,
      register: input.draft.register,
      format: input.draft.format,
      estimatedReadingMinutes: input.draft.estimatedReadingMinutes,
      oralTransferType: input.draft.oralTransferType,
      paragraphs: input.draft.paragraphs,
      changeReason: `Fixture revision for ${input.feedback.length} review finding(s).`,
    };
  }
}

export function mergeArticleRevision(draft: ArticleCandidateDraft, payload: ArticleRevisionPayload): ArticleCandidateDraft {
  const next = articleCandidateDraftSchema.parse({
    ...draft,
    ...payload,
    changeReason: payload.changeReason ?? draft.changeReason,
    contentHash: articleCandidateContentHash({
      canonicalUrl: draft.canonicalUrl,
      title: payload.title ?? draft.title,
      summary: payload.summary ?? draft.summary,
      paragraphs: payload.paragraphs ?? draft.paragraphs,
    }),
  });
  return next;
}

export function createConfiguredArticleRevisionProvider(options: Readonly<{
  provider?: "minimax" | "fake";
  apiKey?: string;
  endpoint?: string;
  modelVersion?: string;
  fetchImplementation?: typeof fetch;
}> = {}): ArticleRevisionProvider {
  const provider = options.provider ?? (process.env.CONTENT_ARTICLE_REVISION_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax";
  if (provider === "fake") {
    if (process.env.NODE_ENV === "production" || process.env.CONTENT_ARTICLE_ALLOW_FAKE_REVIEW !== "1") throw new Error("ARTICLE_REVISION_FAKE_PROVIDER_NOT_ALLOWED");
    return new FakeArticleRevisionProvider();
  }
  if (provider !== "minimax") throw new Error("ARTICLE_REVISION_PROVIDER_UNSUPPORTED");
  const apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
  if (!apiKey.trim()) throw new Error("ARTICLE_REVISION_MINIMAX_NOT_CONFIGURED");
  return new MiniMaxArticleRevisionProvider({
    apiKey,
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultEndpoint,
    modelVersion: options.modelVersion ?? process.env.CONTENT_ARTICLE_REVISION_MODEL ?? defaultModel,
    fetchImplementation: options.fetchImplementation,
  });
}
