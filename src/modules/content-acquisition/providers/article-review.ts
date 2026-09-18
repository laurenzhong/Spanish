import { createHash } from "node:crypto";

import { z } from "zod";

import type { ArticleCandidateDraft } from "../normalizers";

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
 * The default provider is intentionally deterministic and local. It is a
 * contract-safe fixture until a separately approved review service is wired.
 */
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
