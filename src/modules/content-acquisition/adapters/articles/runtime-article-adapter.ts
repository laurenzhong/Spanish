import { z } from "zod";

import type { ContentSourceRecord } from "../../repositories";
import { ContentSourceAdapterError } from "../content-source-adapter";
import { ArticleRssAdapter } from "../rss/article-rss-adapter";
import { ArticleSourceAdapter } from "./article-source-adapter";

export const articleRssRightsPolicySchema = z.strictObject({
  contentMode: z.literal("full_text"),
  sourceType: z.enum(["original", "public_domain", "creative_commons", "licensed"]),
  license: z.enum(["original", "public_domain", "creative_commons", "licensed"]),
  attribution: z.string().trim().min(1).max(1_000),
  licenseEvidence: z.url().startsWith("https://"),
  allowedFeedHosts: z.array(z.string().trim().min(1)).max(20).default([]),
  allowedArticleHosts: z.array(z.string().trim().min(1)).min(1).max(50),
  cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  topics: z.array(z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u)).min(1).max(20),
  region: z.string().trim().min(2).max(40),
  register: z.string().trim().min(2).max(80),
  format: z.enum(["news", "essay", "dialogue", "guide", "story"]),
  oralTransferType: z.enum(["none", "summary", "opinion", "personal_transfer"]),
  maxFeedBytes: z.number().int().min(1_024).max(5_000_000).default(1_000_000),
  maxArticleBytes: z.number().int().min(1_024).max(5_000_000).default(1_500_000),
});

export function createArticleRssAdapterFromSource(
  source: ContentSourceRecord,
  fetchImpl: typeof fetch = fetch,
): ArticleRssAdapter {
  if (
    !source.enabled
    || source.adapterType !== "article-rss"
    || source.sourceKind !== "article-feed"
    || source.rightsStatus !== "verified"
  ) {
    throw new ContentSourceAdapterError("Article RSS requires an enabled, verified article-feed source.", false);
  }
  let feedUrl: URL;
  try {
    feedUrl = new URL(source.externalSourceId);
  } catch {
    throw new ContentSourceAdapterError("Article feed URL is invalid.", false);
  }
  const policy = articleRssRightsPolicySchema.safeParse(source.rightsPolicy ?? {});
  if (!policy.success) {
    throw new ContentSourceAdapterError("Article source rights policy is incomplete or invalid.", false);
  }
  const feedHosts = [...new Set([feedUrl.hostname.toLowerCase(), ...policy.data.allowedFeedHosts.map((host) => host.toLowerCase())])];
  const articleHosts = [...new Set(policy.data.allowedArticleHosts.map((host) => host.toLowerCase()))];
  const pageAdapter = new ArticleSourceAdapter({
    fetch: fetchImpl,
    allowedHosts: articleHosts,
    maxBytes: policy.data.maxArticleBytes,
  });
  return new ArticleRssAdapter({
    fetch: fetchImpl,
    allowedHosts: feedHosts,
    pageAdapter,
    maxBytes: policy.data.maxFeedBytes,
    source: {
      sourceName: source.displayName,
      sourceType: policy.data.sourceType,
      license: policy.data.license,
      attribution: policy.data.attribution,
      licenseEvidence: policy.data.licenseEvidence,
    },
    defaults: {
      cefr: policy.data.cefr,
      topics: policy.data.topics,
      region: policy.data.region,
      register: policy.data.register,
      format: policy.data.format,
      oralTransferType: policy.data.oralTransferType,
    },
  });
}
