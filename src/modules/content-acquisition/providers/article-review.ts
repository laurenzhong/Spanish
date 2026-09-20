import { createHash } from "node:crypto";

import { z } from "zod";

import type { ArticleCandidateDraft } from "../normalizers";
import { parseProviderJson } from "./parse-provider-json";

export const articleReviewDecisions = ["approved", "changes_requested", "rejected"] as const;
export type ArticleReviewDecision = (typeof articleReviewDecisions)[number];

export const articleReviewResultSchema = z.strictObject({
  decision: z.enum(articleReviewDecisions),
  notes: z.string().trim().max(4_000),
  modelVersion: z.string().trim().min(1).max(160),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type ArticleReviewInput = Readonly<{
  candidateId: string;
  candidateRevision: number;
  contentHash: string;
  title: string;
  summary: string;
  paragraphs: readonly string[];
  draft: ArticleCandidateDraft;
}>;

export type ArticleReviewResult = z.infer<typeof articleReviewResultSchema>;

export interface ArticleReviewProvider {
  readonly dimension: "content-es-ES" | "teaching-zh-CN";
  review(input: ArticleReviewInput): Promise<ArticleReviewResult>;
}

export type MiniMaxArticleReviewProviderOptions = Readonly<{
  apiKey: string;
  endpoint?: string;
  modelVersion?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  clock?: () => number;
}>;

const defaultMiniMaxEndpoint = "https://api.minimaxi.com/anthropic/v1/messages";
const defaultMiniMaxModel = "MiniMax-M3";
const anthropicResponseSchema = z.object({
  content: z.array(z.object({ type: z.literal("text"), text: z.string() }).strict()).min(1),
}).passthrough();
// Models sometimes add a bounded rationale field despite the JSON-only prompt.
// Validate the decision contract while ignoring non-authoritative extras.
const providerPayloadSchema = z.object({
  decision: z.enum(articleReviewDecisions),
  notes: z.string().trim().max(4_000),
});

export function articleReviewInputHash(input: ArticleReviewInput): string {
  return createHash("sha256").update(JSON.stringify({
    candidateId: input.candidateId,
    candidateRevision: input.candidateRevision,
    contentHash: input.contentHash,
    title: input.title,
    summary: input.summary,
    paragraphs: input.paragraphs,
    draft: input.draft,
  })).digest("hex");
}

/**
 * MiniMax is an assessor only. It receives a frozen candidate revision and
 * returns a bounded review decision; it never writes workflow state itself.
 */
export class MiniMaxArticleReviewProvider implements ArticleReviewProvider {
  readonly dimension: "content-es-ES" | "teaching-zh-CN";
  private readonly endpoint: string;
  private readonly modelVersion: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly clock: () => number;

  constructor(
    dimension: "content-es-ES" | "teaching-zh-CN",
    private readonly options: MiniMaxArticleReviewProviderOptions,
  ) {
    this.dimension = dimension;
    this.endpoint = options.endpoint ?? defaultMiniMaxEndpoint;
    this.modelVersion = `${options.modelVersion ?? defaultMiniMaxModel}/${dimension}`;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.clock = options.clock ?? Date.now;
  }

  async review(input: ArticleReviewInput): Promise<ArticleReviewResult> {
    if (!this.options.apiKey.trim()) throw new Error("ARTICLE_REVIEW_MINIMAX_NOT_CONFIGURED");
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
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
          model: this.options.modelVersion ?? defaultMiniMaxModel,
          max_tokens: 900,
          thinking: { type: "disabled" },
          stream: false,
          system: buildSystemPrompt(this.dimension),
          messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({
            candidateId: input.candidateId,
            candidateRevision: input.candidateRevision,
            contentHash: input.contentHash,
            title: input.title,
            summary: input.summary,
            paragraphs: input.paragraphs,
            draft: input.draft,
          }) }] }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw providerStatusError(response.status);
      const envelope = anthropicResponseSchema.safeParse(await response.json().catch(() => null));
      if (!envelope.success) throw new Error("ARTICLE_REVIEW_PROVIDER_RESPONSE_INVALID");
      const text = envelope.data.content.map((block) => block.text).join("\n").trim();
      const payload = providerPayloadSchema.safeParse(parseProviderJson(text));
      if (!payload.success) throw new Error("ARTICLE_REVIEW_PROVIDER_RESPONSE_INVALID");
      // Keep provider metadata in the immutable result without trusting model-supplied hashes.
      void startedAt;
      return {
        ...payload.data,
        modelVersion: this.modelVersion,
        inputHash: articleReviewInputHash(input),
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ARTICLE_REVIEW_")) throw error;
      if (timedOut) throw new Error("ARTICLE_REVIEW_PROVIDER_TIMEOUT");
      if (controller.signal.aborted) throw new Error("ARTICLE_REVIEW_PROVIDER_CANCELLED");
      throw new Error("ARTICLE_REVIEW_PROVIDER_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildSystemPrompt(dimension: "content-es-ES" | "teaching-zh-CN"): string {
  if (dimension === "content-es-ES") {
    return [
      "You are the Spanish-language review gate for a licensed learning article.",
      "Review only the supplied frozen article revision.",
      "Check Spanish naturalness, internal coherence, CEFR suitability, title/summary alignment, and that no unsupported facts are introduced.",
      "Do not publish, rewrite, or claim to be a human native speaker.",
      "Return JSON only: {decision: approved|changes_requested|rejected, notes: string}.",
    ].join(" ");
  }
  return [
    "You are the Simplified Chinese teaching review gate for a licensed Spanish-learning article.",
    "Review only the supplied frozen article revision.",
    "Check whether the article is pedagogically usable for an A2-B1 learner, whether metadata and suggested transfer are clear, and whether any explanation would mislead a learner.",
    "Do not invent translations, facts, rights, or learner evidence.",
    "Return JSON only: {decision: approved|changes_requested|rejected, notes: string}.",
  ].join(" ");
}

function providerStatusError(status: number): Error {
  if (status === 401 || status === 403) return new Error("ARTICLE_REVIEW_PROVIDER_AUTH_FAILED");
  if (status === 429) return new Error("ARTICLE_REVIEW_PROVIDER_RATE_LIMITED");
  if (status >= 500) return new Error("ARTICLE_REVIEW_PROVIDER_UNAVAILABLE");
  return new Error("ARTICLE_REVIEW_PROVIDER_RESPONSE_INVALID");
}

/** Contract-safe fixture factory for unit and contract tests. */
export class FakeArticleReviewProvider implements ArticleReviewProvider {
  constructor(
    public readonly dimension: "content-es-ES" | "teaching-zh-CN",
    private readonly modelVersion = `fake-article-review-${dimension}-v1`,
  ) {}

  async review(input: ArticleReviewInput): Promise<ArticleReviewResult> {
    const inputHash = articleReviewInputHash(input);
    const decision: ArticleReviewDecision = input.paragraphs.length > 0 ? "approved" : "changes_requested";
    return {
      decision,
      notes: decision === "approved" ? "Fixture review passed; replace with an approved provider before production." : "Article has no readable paragraphs.",
      modelVersion: this.modelVersion,
      inputHash,
    };
  }
}

export function createDefaultArticleReviewProviders(): Readonly<{
  content: ArticleReviewProvider;
  teaching: ArticleReviewProvider;
}> {
  return {
    content: new FakeArticleReviewProvider("content-es-ES"),
    teaching: new FakeArticleReviewProvider("teaching-zh-CN"),
  };
}

export function createConfiguredArticleReviewProviders(options: Readonly<{
  provider?: "minimax" | "fake";
  apiKey?: string;
  endpoint?: string;
  modelVersion?: string;
  fetchImplementation?: typeof fetch;
}> = {}): Readonly<{ content: ArticleReviewProvider; teaching: ArticleReviewProvider }> {
  const provider = options.provider ?? (process.env.CONTENT_ARTICLE_REVIEW_PROVIDER as "minimax" | "fake" | undefined) ?? "minimax";
  if (provider === "fake") {
    if (process.env.NODE_ENV === "production" || process.env.CONTENT_ARTICLE_ALLOW_FAKE_REVIEW !== "1") {
      throw new Error("ARTICLE_REVIEW_FAKE_PROVIDER_NOT_ALLOWED");
    }
    return createDefaultArticleReviewProviders();
  }
  if (provider !== "minimax") throw new Error("ARTICLE_REVIEW_PROVIDER_UNSUPPORTED");
  const providerOptions = {
    apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY ?? "",
    endpoint: options.endpoint ?? process.env.MINIMAX_API_ENDPOINT ?? defaultMiniMaxEndpoint,
    modelVersion: options.modelVersion ?? process.env.CONTENT_ARTICLE_REVIEW_MODEL ?? defaultMiniMaxModel,
    fetchImplementation: options.fetchImplementation,
  } satisfies MiniMaxArticleReviewProviderOptions;
  if (!providerOptions.apiKey.trim()) throw new Error("ARTICLE_REVIEW_MINIMAX_NOT_CONFIGURED");
  return {
    content: new MiniMaxArticleReviewProvider("content-es-ES", providerOptions),
    teaching: new MiniMaxArticleReviewProvider("teaching-zh-CN", providerOptions),
  };
}
