import type { ContentSourceAdapter } from "../adapters";
import {
  articlePublicationModes,
  planDailyArticleRun,
  type ArticlePublicationMode,
} from "../domain/article-publication-policy";
import { autoPublishArticleCandidate } from "./auto-publish-article";
import { prepareArticleCandidateForReview } from "./prepare-article-candidate-for-review";
import { runAcquisitionSource } from "./run-acquisition-source";
import { runArticleReview } from "./run-article-review";
import type { ArticleReviewProvider } from "../providers/article-review";
import type { CandidatePublisherRegistry } from "../publishers";
import type {
  ContentAcquisitionRepository,
  ContentSourceRecord,
  ContentWorkflowRepository,
} from "../repositories";

type DailyArticleRepository = ContentAcquisitionRepository & ContentWorkflowRepository;

export type DailyArticlePipelineFailure = Readonly<{
  scope: "source" | "candidate";
  sourceStableKey?: string;
  candidateId?: string;
  code: string;
}>;

export type DailyArticlePipelineResult = Readonly<{
  runKey: string;
  mode: ArticlePublicationMode;
  dailyLimit: number;
  discovered: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  prepared: number;
  reviewed: number;
  approved: number;
  changesRequested: number;
  rejected: number;
  published: number;
  skipped: number;
  skippedSources: readonly Readonly<{ sourceStableKey: string; reason: string }>[];
  failures: readonly DailyArticlePipelineFailure[];
}>;

export type RunDailyArticlePipelineDependencies = Readonly<{
  repository: DailyArticleRepository;
  resolveAdapter: (source: ContentSourceRecord) => ContentSourceAdapter | Promise<ContentSourceAdapter>;
  reviewProviders?: Readonly<{
    content: ArticleReviewProvider;
    teaching: ArticleReviewProvider;
  }>;
  publishers?: CandidatePublisherRegistry;
  now?: () => Date;
}>;

function errorCode(error: unknown): string {
  const value = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.message
      : "DAILY_ARTICLE_PIPELINE_FAILED";
  return value.replace(/^CONTENT_PROCESSING_FAILED:\s*/u, "").replace(/[^A-Z0-9_.:-]/giu, "_").slice(0, 120);
}

function emptyResult(plan: ReturnType<typeof planDailyArticleRun>): DailyArticlePipelineResult {
  return {
    runKey: plan.runKey,
    mode: plan.mode,
    dailyLimit: plan.dailyLimit,
    discovered: 0,
    inserted: 0,
    duplicates: 0,
    conflicts: 0,
    prepared: 0,
    reviewed: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    published: 0,
    skipped: 0,
    skippedSources: plan.skippedSources,
    failures: [],
  };
}

export async function runDailyArticlePipeline(
  dependencies: RunDailyArticlePipelineDependencies,
  input: Readonly<{
    date: string;
    mode: ArticlePublicationMode;
    policyVersion: string;
    dailyLimit: number;
    defaultSourceLimit: number;
  }>,
): Promise<DailyArticlePipelineResult> {
  const sources = await dependencies.repository.listSources();
  const plan = planDailyArticleRun({ ...input, sources });
  if (plan.mode === "disabled") return emptyResult(plan);

  const sourceByStableKey = new Map(sources.map((source) => [source.stableKey, source]));
  const failures: DailyArticlePipelineFailure[] = [];
  let discovered = 0;
  let inserted = 0;
  let duplicates = 0;
  let conflicts = 0;
  let prepared = 0;
  let reviewed = 0;
  let approved = 0;
  let changesRequested = 0;
  let rejected = 0;
  let published = 0;
  let skipped = 0;

  for (const sourcePlan of plan.sourcePlans) {
    const source = sourceByStableKey.get(sourcePlan.sourceStableKey);
    if (!source) {
      failures.push({ scope: "source", sourceStableKey: sourcePlan.sourceStableKey, code: "SOURCE_NOT_FOUND" });
      continue;
    }
    let acquisition;
    try {
      const adapter = await dependencies.resolveAdapter(source);
      acquisition = await runAcquisitionSource({
        repository: dependencies.repository,
        adapter,
        input: { sourceStableKey: source.stableKey, dryRun: false, limit: sourcePlan.sourceLimit },
      });
      discovered += acquisition.discovered;
      inserted += acquisition.inserted;
      duplicates += acquisition.duplicates;
      conflicts += acquisition.conflicts;
    } catch (error) {
      failures.push({ scope: "source", sourceStableKey: source.stableKey, code: errorCode(error) });
      continue;
    }

    if (plan.mode === "discover-only") continue;
    const [discoveredCandidatesRaw, reviewReadyCandidatesRaw] = await Promise.all([
      dependencies.repository.listCandidates({
        sourceId: source.id,
        status: "discovered",
        contentType: "article",
        limit: sourcePlan.sourceLimit,
      }),
      dependencies.repository.listCandidates({
        sourceId: source.id,
        status: "review_ready",
        contentType: "article",
        limit: sourcePlan.sourceLimit,
      }),
    ]);
    const discoveredCandidates = discoveredCandidatesRaw.filter((candidate) => candidate.publicationStatus === "draft");
    const reviewReadyCandidates = reviewReadyCandidatesRaw.filter((candidate) => candidate.publicationStatus === "draft");
    const pendingCandidates = [...reviewReadyCandidates, ...discoveredCandidates];
    const pendingById = new Map(pendingCandidates.map((candidate) => [candidate.id, candidate]));
    const candidateIds = [...new Set([
      ...reviewReadyCandidates.map((candidate) => candidate.id),
      ...discoveredCandidates.map((candidate) => candidate.id),
      ...acquisition.insertedCandidateIds,
    ])].slice(0, sourcePlan.sourceLimit);
    const candidateIdsToPrepare = candidateIds.filter((candidateId) => {
      const candidate = pendingById.get(candidateId);
      return acquisition.insertedCandidateIds.includes(candidateId) || candidate?.status === "discovered";
    });
    const readyCandidateIds = new Set(candidateIds.filter((candidateId) => pendingById.get(candidateId)?.status === "review_ready"));
    for (const candidateId of candidateIdsToPrepare) {
      try {
        await prepareArticleCandidateForReview(dependencies.repository, candidateId);
        prepared += 1;
        readyCandidateIds.add(candidateId);
      } catch (error) {
        failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: errorCode(error) });
      }
    }
    for (const candidateId of readyCandidateIds) {
      if (!dependencies.reviewProviders) {
        failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: "ARTICLE_REVIEW_PROVIDER_UNAVAILABLE" });
        continue;
      }
      const review = await runArticleReview(dependencies.repository, {
        candidateId,
        contentProvider: dependencies.reviewProviders.content,
        teachingProvider: dependencies.reviewProviders.teaching,
        now: dependencies.now,
      });
      reviewed += 1;
      if (review.status === "approved") approved += 1;
      else if (review.status === "changes_requested") changesRequested += 1;
      else if (review.status === "rejected") rejected += 1;
      else failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: review.reason ?? "ARTICLE_REVIEW_FAILED" });

      if (plan.mode !== "auto-publish" || review.status !== "approved") continue;
      if (!dependencies.publishers) {
        failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: "ARTICLE_PUBLISHER_UNAVAILABLE" });
        continue;
      }
      try {
        const publication = await autoPublishArticleCandidate(dependencies.repository, dependencies.publishers, {
          candidateId,
          mode: plan.mode,
          policyVersion: plan.policyVersion,
          actor: `article-auto-publication:${plan.policyVersion}`,
          runId: plan.runKey,
          now: dependencies.now,
        });
        if (publication.status === "published") published += 1;
        else if (publication.status === "skipped") skipped += 1;
        else failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: publication.reason ?? "ARTICLE_PUBLICATION_FAILED" });
      } catch (error) {
        failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId, code: errorCode(error) });
      }
    }
  }

  return {
    runKey: plan.runKey,
    mode: plan.mode,
    dailyLimit: plan.dailyLimit,
    discovered,
    inserted,
    duplicates,
    conflicts,
    prepared,
    reviewed,
    approved,
    changesRequested,
    rejected,
    published,
    skipped,
    skippedSources: plan.skippedSources,
    failures,
  };
}

export { articlePublicationModes };
