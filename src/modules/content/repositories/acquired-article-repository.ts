import type { ArticleFormat, ArticleOralTransferType } from "../domain/article";

export type AcquiredArticleReview = Readonly<{
  locale: "es-ES" | "zh-CN";
  /** Owner-authorized AI review identity; historical `codex-*` records stay valid. */
  reviewerReference: string;
  notes: string | null;
  reviewedAt: Date;
}>;

export type AcquiredArticleDraft = Readonly<{
  stableKey: string;
  locale: string;
  title: string;
  summary: string;
  author: string | null;
  canonicalUrl: string;
  publicationDate: string | null;
  sourceName: string;
  sourceType: "original" | "ai_assisted_original" | "public_domain" | "creative_commons" | "licensed" | "short_quote";
  license: "original" | "public_domain" | "creative_commons" | "licensed" | "short_quote";
  attribution: string;
  licenseEvidence: string;
  copyrightStatus: "cleared";
  fetchedAt: string;
  contentHash: string;
  cefr: "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
  topics: readonly string[];
  region: string;
  register: string;
  format: ArticleFormat;
  estimatedReadingMinutes: number;
  oralTransferType: ArticleOralTransferType;
  paragraphs: readonly string[];
  changeReason: string;
}>;

export type AcquiredArticlePublication = Readonly<{
  kind: "article";
  stableKey: string;
  version: number;
}>;

export interface AcquiredArticleRepository {
  publishAcquired(input: Readonly<{
    candidateId: string;
    candidateRevision: number;
    contentHash: string;
    draft: AcquiredArticleDraft;
    reviews: readonly [AcquiredArticleReview, AcquiredArticleReview];
    publishedAt: Date;
  }>): Promise<AcquiredArticlePublication>;
  archiveAcquired(input: Readonly<{
    candidateId: string;
    publication: AcquiredArticlePublication;
    archivedAt: Date;
  }>): Promise<void>;
}
