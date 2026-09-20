import type { ContentSourceRecord } from "../repositories";

export const articlePublicationModes = ["disabled", "discover-only", "review-only", "auto-publish"] as const;
export type ArticlePublicationMode = (typeof articlePublicationModes)[number];

const READLANG_SOURCE_URL = "https://readlang.com/es/links";

function articleSourcePriority(source: ContentSourceRecord): number {
  // Readlang's adapter queues the 100 exact `/library/<id>` URLs before the
  // remaining authorized snapshot links. Run that source before RSS sources so
  // the global daily quota is spent on the requested library set first.
  return source.adapterType === "readlang-links" && source.externalSourceId === READLANG_SOURCE_URL ? 0 : 10;
}

export type ArticleDailySourcePlan = Readonly<{
  sourceStableKey: string;
  sourceLimit: number;
}>;

export type ArticleDailyRunPlan = Readonly<{
  runKey: string;
  policyVersion: string;
  mode: ArticlePublicationMode;
  dailyLimit: number;
  sourcePlans: readonly ArticleDailySourcePlan[];
  skippedSources: readonly Readonly<{ sourceStableKey: string; reason: string }>[];
}>;

export class ArticlePublicationPolicyError extends Error {
  readonly code = "ARTICLE_PUBLICATION_POLICY_INVALID" as const;
}

type AutomatedPublicationPolicy = Readonly<{
  enabled?: unknown;
  policyVersion?: unknown;
  approvedAt?: unknown;
  dailyLimit?: unknown;
}>;

function automatedPolicy(source: ContentSourceRecord): AutomatedPublicationPolicy {
  const value = source.rightsPolicy?.automatedPublication;
  return value && typeof value === "object" ? value as AutomatedPublicationPolicy : {};
}

function isUsablePolicy(source: ContentSourceRecord, expectedVersion: string): boolean {
  const policy = automatedPolicy(source);
  return policy.enabled === true
    && policy.policyVersion === expectedVersion
    && typeof policy.approvedAt === "string"
    && !Number.isNaN(Date.parse(policy.approvedAt));
}

function sourceEligibleForMode(source: ContentSourceRecord, mode: ArticlePublicationMode, expectedVersion: string): boolean {
  const baseEligible = source.enabled
    && source.rightsStatus === "verified"
    && ((source.adapterType === "article-rss" && source.sourceKind === "article-feed")
      || (source.adapterType === "readlang-links" && source.sourceKind === "article-site" && source.externalSourceId === READLANG_SOURCE_URL));
  if (!baseEligible) return false;
  if (mode === "discover-only") return true;
  if (source.adapterType === "readlang-links") {
    const configuredVersion = source.rightsPolicy?.policyVersion;
    return mode === "review-only"
      ? configuredVersion === expectedVersion
      : isUsablePolicy(source, expectedVersion);
  }
  return isUsablePolicy(source, expectedVersion);
}

export function planDailyArticleRun(input: Readonly<{
  date: string;
  mode: ArticlePublicationMode;
  policyVersion: string;
  dailyLimit: number;
  defaultSourceLimit: number;
  sources: readonly ContentSourceRecord[];
}>): ArticleDailyRunPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.date)) throw new ArticlePublicationPolicyError("date must use YYYY-MM-DD.");
  if (!articlePublicationModes.includes(input.mode)) throw new ArticlePublicationPolicyError("mode is invalid.");
  if (input.mode !== "disabled" && !input.policyVersion.trim()) throw new ArticlePublicationPolicyError("policyVersion is required unless mode is disabled.");
  if (!Number.isInteger(input.dailyLimit) || input.dailyLimit < 0 || input.dailyLimit > 50) throw new ArticlePublicationPolicyError("dailyLimit must be between 0 and 50.");
  if (!Number.isInteger(input.defaultSourceLimit) || input.defaultSourceLimit < 1 || input.defaultSourceLimit > 50) throw new ArticlePublicationPolicyError("defaultSourceLimit must be between 1 and 50.");

  const eligible = [...input.sources]
    .sort((left, right) => articleSourcePriority(left) - articleSourcePriority(right)
      || left.stableKey.localeCompare(right.stableKey))
    .filter((source) => source.enabled && source.rightsStatus === "verified"
      && ((source.adapterType === "article-rss" && source.sourceKind === "article-feed")
        || (source.adapterType === "readlang-links" && source.sourceKind === "article-site" && source.externalSourceId === READLANG_SOURCE_URL)));
  const skippedSources = input.sources
    .filter((source) => !eligible.includes(source))
    .map((source) => ({
      sourceStableKey: source.stableKey,
      reason: !source.enabled ? "source-disabled" : source.adapterType === "readlang-links" && source.sourceKind === "article-site" && source.externalSourceId !== READLANG_SOURCE_URL
        ? "readlang-source-url-not-exact" : ((source.adapterType !== "article-rss" || source.sourceKind !== "article-feed")
          && (source.adapterType !== "readlang-links" || source.sourceKind !== "article-site")) ? "not-article-source" : source.rightsStatus !== "verified" ? "rights-not-verified" : "source-ineligible",
    }));
  const sourcePlans: ArticleDailySourcePlan[] = [];
  if (input.mode === "disabled") {
    return {
      runKey: `article-daily:${input.date}:${input.policyVersion}`,
      policyVersion: input.policyVersion,
      mode: input.mode,
      dailyLimit: input.dailyLimit,
      sourcePlans,
      skippedSources: input.sources.map((source) => ({ sourceStableKey: source.stableKey, reason: "mode-disabled" })),
    };
  }
  let remaining = input.dailyLimit;
  for (const source of eligible) {
    if (!sourceEligibleForMode(source, input.mode, input.policyVersion)) {
      skippedSources.push({ sourceStableKey: source.stableKey, reason: "automated-publication-policy-not-approved" });
      continue;
    }
    const configuredLimit = automatedPolicy(source).dailyLimit;
    const sourceLimit = typeof configuredLimit === "number" && Number.isInteger(configuredLimit) && configuredLimit > 0
      ? Math.min(configuredLimit, input.defaultSourceLimit)
      : input.defaultSourceLimit;
    const allocation = Math.min(sourceLimit, remaining);
    if (allocation > 0) sourcePlans.push({ sourceStableKey: source.stableKey, sourceLimit: allocation });
    remaining -= allocation;
    if (remaining === 0) break;
  }
  return {
    runKey: `article-daily:${input.date}:${input.policyVersion}`,
    policyVersion: input.policyVersion,
    mode: input.mode,
    dailyLimit: input.dailyLimit,
    sourcePlans,
    skippedSources,
  };
}
