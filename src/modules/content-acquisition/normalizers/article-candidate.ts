import { createHash } from "node:crypto";

import { z } from "zod";

import { normalizeCandidateUrl } from "../domain";

const sourceLicenseSchema = z.enum(["original", "public_domain", "creative_commons", "licensed", "short_quote"]);
const sourceTypeSchema = z.enum(["original", "ai_assisted_original", "public_domain", "creative_commons", "licensed", "short_quote"]);
const stableKeySchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u);

export const articleCandidateDraftSchema = z.strictObject({
  stableKey: stableKeySchema,
  locale: z.string().trim().min(2).max(35),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(4_000),
  author: z.string().trim().min(1).max(300).nullable(),
  canonicalUrl: z.url().startsWith("https://"),
  publicationDate: z.iso.date().nullable(),
  sourceName: z.string().trim().min(1).max(300),
  sourceType: sourceTypeSchema,
  license: sourceLicenseSchema,
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  copyrightStatus: z.literal("cleared"),
  fetchedAt: z.iso.datetime({ offset: true }),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  topics: z.array(stableKeySchema).min(1),
  region: z.string().trim().min(2).max(40),
  register: z.string().trim().min(2).max(80),
  format: z.enum(["news", "essay", "dialogue", "guide", "story"]),
  estimatedReadingMinutes: z.number().int().positive().max(240),
  oralTransferType: z.enum(["none", "summary", "opinion", "personal_transfer"]),
  paragraphs: z.array(z.string().trim().min(1).max(8_000)).min(1).max(500),
  changeReason: z.string().trim().min(1).max(2_000),
});

export type ArticleCandidateDraft = z.infer<typeof articleCandidateDraftSchema>;

export class ArticleCandidateValidationError extends Error {
  readonly code = "CONTENT_PROCESSING_FAILED" as const;

  constructor(message: string) {
    super(`CONTENT_PROCESSING_FAILED: ${message}`);
    this.name = "ArticleCandidateValidationError";
  }
}

function normalizedText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function contentDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Hashes only the mutable reading payload; source rights and attribution stay immutable. */
export function articleCandidateContentHash(input: Readonly<{
  canonicalUrl: string;
  title: string;
  summary: string;
  paragraphs: readonly string[];
}>): string {
  return contentDigest({
    canonicalUrl: input.canonicalUrl,
    title: input.title,
    summary: input.summary,
    paragraphs: input.paragraphs,
  });
}

export function normalizeArticleCandidate(input: Readonly<{
  sourceStableKey: string;
  externalItemId: string;
  canonicalUrl: string;
  title: string;
  summary: string;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  paragraphs: readonly string[];
  source: Readonly<{
    sourceName: string;
    sourceType: z.infer<typeof sourceTypeSchema>;
    license: z.infer<typeof sourceLicenseSchema>;
    attribution: string;
    licenseEvidence: string;
  }>;
  defaults: Readonly<{
    cefr: ArticleCandidateDraft["cefr"];
    topics: readonly string[];
    region: string;
    register: string;
    format: ArticleCandidateDraft["format"];
    oralTransferType: ArticleCandidateDraft["oralTransferType"];
  }>;
}>) {
  try {
    const canonicalUrl = normalizeCandidateUrl(input.canonicalUrl);
    if (!canonicalUrl.startsWith("https://")) throw new Error("Article canonical URL must use HTTPS.");
    const title = normalizedText(input.title);
    const paragraphs = input.paragraphs.map(normalizedText).filter(Boolean);
    const summary = normalizedText(input.summary) || paragraphs[0]?.slice(0, 400) || "";
    const stableKey = `article.acquired.${contentDigest(canonicalUrl).slice(0, 24)}`;
    const hashInput = { canonicalUrl, title, summary, paragraphs };
    const contentHash = contentDigest(hashInput);
    const draft = articleCandidateDraftSchema.parse({
      stableKey,
      locale: "es-ES",
      title,
      summary,
      author: input.author ? normalizedText(input.author) : null,
      canonicalUrl,
      publicationDate: isoDate(input.publishedAt),
      sourceName: input.source.sourceName,
      sourceType: input.source.sourceType,
      license: input.source.license,
      attribution: input.source.attribution,
      licenseEvidence: input.source.licenseEvidence,
      copyrightStatus: "cleared",
      fetchedAt: new Date(input.fetchedAt).toISOString(),
      contentHash,
      cefr: input.defaults.cefr,
      topics: [...input.defaults.topics],
      region: input.defaults.region,
      register: input.defaults.register,
      format: input.defaults.format,
      estimatedReadingMinutes: Math.max(1, Math.ceil(paragraphs.join(" ").split(/\s+/u).length / 180)),
      oralTransferType: input.defaults.oralTransferType,
      paragraphs,
      changeReason: `Imported from reviewed source ${input.sourceStableKey}.`,
    });
    return {
      externalItemId: normalizedText(input.externalItemId),
      canonicalUrl,
      title: draft.title,
      contentType: "article" as const,
      language: "es",
      publishedAt: input.publishedAt ? new Date(input.publishedAt).toISOString() : null,
      contentHash,
      metadata: { articleDraft: draft },
    };
  } catch (error) {
    if (error instanceof ArticleCandidateValidationError) throw error;
    throw new ArticleCandidateValidationError(error instanceof Error ? error.message : "Article candidate is invalid.");
  }
}
