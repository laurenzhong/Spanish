import type { ContentSourceAdapter } from "../adapters";
import { isOwnerAuthorizedReviewerReference } from "../domain";
import type { ContentAcquisitionRepository, ContentCandidateRecord, ContentSourceRecord, ContentWorkflowRepository } from "../repositories";
import { preparePodcastCandidateForReview } from "./prepare-podcast-candidate-for-review";
import { prepareVideoCandidateForReview } from "./prepare-video-candidate-for-review";
import { runAcquisitionSource } from "./run-acquisition-source";
import { runMediaReview } from "./run-media-review";
import { reviseMediaCandidateAfterReview } from "./revise-media-candidate";
import { autoPublishMediaCandidate } from "./auto-publish-media";
import { processDailyMediaCandidate } from "./process-daily-media-candidate";
import type { ContentMediaRuntime } from "./content-media-runtime";
import type { MediaReviewProvider } from "../providers/media-review";
import type { MediaRevisionProvider } from "../providers/media-revision";
import type { CandidatePublisherRegistry } from "../publishers";

export const mediaPublicationModes = ["disabled", "discover-only", "review-only", "auto-publish"] as const;
export type MediaPublicationMode = typeof mediaPublicationModes[number];

type DailyMediaRepository = ContentAcquisitionRepository & ContentWorkflowRepository;

function hasCurrentMediaApprovals(candidate: Readonly<{ revision: number }>, reviews: readonly Readonly<{
  dimension: string;
  status: string;
  candidateRevision: number;
  reviewerReference: string | null;
}>[]) {
  return (["content-es-ES", "teaching-zh-CN", "structure"] as const).every((dimension) => reviews.some((review) =>
    review.dimension === dimension
    && review.status === "approved"
    && review.candidateRevision === candidate.revision
    && isOwnerAuthorizedReviewerReference(review.reviewerReference)));
}

export type DailyMediaPipelineFailure = Readonly<{
  scope: "source" | "candidate";
  sourceStableKey?: string;
  candidateId?: string;
  code: string;
}>;

export type DailyMediaPipelineResult = Readonly<{
  runKey: string;
  mode: MediaPublicationMode;
  dailyLimit: number;
  videoDailyLimit: number;
  podcastDailyLimit: number;
  publishedByType: Readonly<{ video: number; podcast: number }>;
  targetDeficitByType: Readonly<{ video: number; podcast: number }>;
  discovered: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  prepared: number;
  reviewReady: number;
  reviewed: number;
  approved: number;
  changesRequested: number;
  rejected: number;
  published: number;
  skipped: number;
  skippedReasons: Readonly<Record<string, number>>;
  skippedSources: readonly Readonly<{ sourceStableKey: string; reason: string }>[];
  failures: readonly DailyMediaPipelineFailure[];
}>;

export type RunDailyMediaPipelineDependencies = Readonly<{
  repository: DailyMediaRepository;
  resolveAdapter: (source: ContentSourceRecord) => ContentSourceAdapter | Promise<ContentSourceAdapter>;
  reviewProviders?: Readonly<{ content: MediaReviewProvider; teaching: MediaReviewProvider; revision?: MediaRevisionProvider }>;
  publishers?: CandidatePublisherRegistry;
  mediaRuntime?: ContentMediaRuntime;
  now?: () => Date;
}>;

/**
 * Exit contract of the scheduled `media-daily` run.
 *
 * A target shortfall, a `changes_requested`/`rejected` review decision or a
 * candidate-scoped processing error is a content-supply outcome: the next
 * daily run retries the candidate or discovers new material, and the operator
 * reads `targetDeficitByType`, the review counters and the workflow summary.
 * Those outcomes stay visible as `status: "partial"` but must not fail the
 * workflow every day—otherwise the failure email becomes background noise and
 * hides real breakage.
 *
 * An auto-publish run fails only for operational signals:
 * - a `source`-scoped failure (a source could not be read, or the run could
 *   not even count what was already published), or
 * - the run reviewed candidates but nothing was published for the day at all,
 *   which means the review/provider/publisher chain is broken rather than
 *   merely selective.
 */
export function dailyMediaRunFails(
  result: Readonly<Pick<
    DailyMediaPipelineResult,
    "mode" | "failures" | "reviewed" | "publishedByType"
  >>,
): boolean {
  if (result.mode !== "auto-publish") return false;
  if (result.failures.some((failure) => failure.scope === "source")) return true;
  const publishedToday = result.publishedByType.video + result.publishedByType.podcast;
  return result.reviewed > 0 && publishedToday === 0;
}

const DEFAULT_MEDIA_SOURCE_TIMEOUT_MS = 180_000;
const DEFAULT_MEDIA_CANDIDATE_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_MEDIA_REVIEW_CONCURRENCY = 2;

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "reasonCode" in error && typeof error.reasonCode === "string") {
    return error.reasonCode;
  }
  const value = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.message
      : "DAILY_MEDIA_PIPELINE_FAILED";
  return value.replace(/^CONTENT_PROCESSING_FAILED:\s*/u, "").replace(/[^A-Z0-9_.:-]/giu, "_").slice(0, 120);
}

function naturalDate(value: Date, timeZone = "Asia/Shanghai"): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isMediaSource(source: ContentSourceRecord): boolean {
  return (source.adapterType === "youtube" && source.sourceKind === "video-channel")
    || (source.adapterType === "podcast-rss" && source.sourceKind === "podcast-feed")
    || (source.adapterType === "language-reactor" && ["video-channel", "podcast-feed"].includes(source.sourceKind));
}

function mediaSourcePriority(source: ContentSourceRecord): number {
  // Language Reactor's YouTube mix is the preferred video directory. The
  // user-authorized `t_pd_mix_es` directory is a podcast feed, so it is kept
  // ahead of other podcasts without being reclassified as video.
  if (source.adapterType === "language-reactor"
    && source.sourceKind === "video-channel"
    && source.externalSourceId === "t_yt_mix_es") return 0;
  if (source.sourceKind === "video-channel") return 10;
  if (source.adapterType === "language-reactor"
    && source.sourceKind === "podcast-feed"
    && source.externalSourceId === "t_pd_mix_es") return 20;
  return 30;
}

function hasHostedVideoAsset(candidate: Readonly<Pick<ContentCandidateRecord, "contentType" | "metadata">>): boolean {
  return candidate.contentType === "video"
    && Boolean(candidate.metadata.bunnyVideoAsset)
    && typeof candidate.metadata.bunnyVideoAsset === "object";
}

export function hasBilingualSubtitleTimeline(candidate: Readonly<Pick<ContentCandidateRecord, "contentType" | "metadata">>): boolean {
  const draftKey = candidate.contentType === "video" ? "videoDraft" : "podcastDraft";
  const draft = candidate.metadata[draftKey];
  if (!draft || typeof draft !== "object" || !("segments" in draft) || !Array.isArray(draft.segments)) return false;
  return draft.segments.length > 0 && draft.segments.every((segment) => {
    if (!segment || typeof segment !== "object") return false;
    const value = segment as Record<string, unknown>;
    return typeof value.sourceText === "string" && value.sourceText.trim().length > 0
      && typeof value.translation === "string" && value.translation.trim().length > 0;
  });
}

export async function runDailyMediaPipeline(
  dependencies: RunDailyMediaPipelineDependencies,
  input: Readonly<{
    date?: string;
    mode: MediaPublicationMode;
    dailyLimit: number;
    videoDailyLimit?: number;
    podcastDailyLimit?: number;
    defaultSourceLimit: number;
    sourceTimeoutMs?: number;
    candidateTimeoutMs?: number;
    reviewConcurrency?: number;
    requireBilingualSubtitles?: boolean;
  }>,
): Promise<DailyMediaPipelineResult> {
  const date = input.date ?? naturalDate((dependencies.now ?? (() => new Date()))());
  const sources = await dependencies.repository.listSources();
  const skippedSources = sources
    .filter((source) => isMediaSource(source) && source.enabled && source.rightsStatus !== "verified")
    .map((source) => ({ sourceStableKey: source.stableKey, reason: "RIGHTS_NOT_VERIFIED" }));
  const eligible = sources
    .filter((source) => isMediaSource(source) && source.enabled && source.rightsStatus === "verified")
    .sort((left, right) => mediaSourcePriority(left) - mediaSourcePriority(right)
      || left.stableKey.localeCompare(right.stableKey));
  const runKey = `media-daily:${date}`;
  const empty = (failures: readonly DailyMediaPipelineFailure[] = []): DailyMediaPipelineResult => ({
    runKey,
    mode: input.mode,
    dailyLimit: input.dailyLimit,
    videoDailyLimit: input.videoDailyLimit ?? input.dailyLimit,
    podcastDailyLimit: input.podcastDailyLimit ?? input.dailyLimit,
    publishedByType: { video: 0, podcast: 0 },
    targetDeficitByType: {
      video: input.videoDailyLimit ?? input.dailyLimit,
      podcast: input.podcastDailyLimit ?? input.dailyLimit,
    },
    discovered: 0,
    inserted: 0,
    duplicates: 0,
    conflicts: 0,
    prepared: 0,
    reviewReady: 0,
    reviewed: 0,
    approved: 0,
    changesRequested: 0,
    rejected: 0,
    published: 0,
    skipped: 0,
    skippedReasons: {},
    skippedSources,
    failures,
  });
  const videoDailyLimit = input.videoDailyLimit ?? input.dailyLimit;
  const podcastDailyLimit = input.podcastDailyLimit ?? input.dailyLimit;
  if (input.mode === "disabled" || (videoDailyLimit === 0 && podcastDailyLimit === 0)) return empty();

  const skippedReasons: Record<string, number> = {};
  const result = { discovered: 0, inserted: 0, duplicates: 0, conflicts: 0, prepared: 0, reviewReady: 0, reviewed: 0, approved: 0, changesRequested: 0, rejected: 0, published: 0, skipped: 0, publishedByType: { video: 0, podcast: 0 } };
  const failures: DailyMediaPipelineFailure[] = [];
  let previouslyPublished = { video: 0, podcast: 0 };
  let publishedCountAvailable = true;
  if (dependencies.repository.countPublishedMediaByType) {
    try {
      previouslyPublished = await dependencies.repository.countPublishedMediaByType({ date });
    } catch (error) {
      publishedCountAvailable = false;
      failures.push({ scope: "source", sourceStableKey: "media-daily", code: errorCode(error) });
    }
  }
  const sourceTimeoutMs = input.sourceTimeoutMs ?? DEFAULT_MEDIA_SOURCE_TIMEOUT_MS;
  const candidateTimeoutMs = input.candidateTimeoutMs ?? DEFAULT_MEDIA_CANDIDATE_TIMEOUT_MS;
  const requestedReviewConcurrency = input.reviewConcurrency ?? DEFAULT_MEDIA_REVIEW_CONCURRENCY;
  const reviewConcurrency = Number.isFinite(requestedReviewConcurrency)
    ? Math.max(1, Math.min(10, Math.floor(requestedReviewConcurrency)))
    : DEFAULT_MEDIA_REVIEW_CONCURRENCY;
  const remainingByType: Record<"video" | "podcast", number> = {
    video: publishedCountAvailable ? Math.max(0, videoDailyLimit - previouslyPublished.video) : 0,
    podcast: publishedCountAvailable ? Math.max(0, podcastDailyLimit - previouslyPublished.podcast) : 0,
  };
  for (const source of eligible) {
    const contentType = source.sourceKind === "video-channel" ? "video" : "podcast";
    if (remainingByType[contentType] <= 0) continue;
    const limit = Math.min(input.defaultSourceLimit, remainingByType[contentType]);
    const sourceSignal = AbortSignal.timeout(sourceTimeoutMs);
    try {
      const adapter = await dependencies.resolveAdapter(source);
      const acquisition = await runAcquisitionSource({
        repository: dependencies.repository,
        adapter,
        input: { sourceStableKey: source.stableKey, dryRun: false, limit },
        signal: sourceSignal,
      });
      result.discovered += acquisition.discovered;
      result.inserted += acquisition.inserted;
      result.duplicates += acquisition.duplicates;
      result.conflicts += acquisition.conflicts;
      remainingByType[contentType] -= acquisition.inserted;
      if (input.mode === "discover-only") continue;
    } catch (error) {
      failures.push({
        scope: "source",
        sourceStableKey: source.stableKey,
        code: sourceSignal.aborted ? "MEDIA_SOURCE_TIMEOUT" : errorCode(error),
      });
      // A transient discovery failure must not strand already discovered,
      // review-ready, or processing drafts for the same verified source.
      if (input.mode === "discover-only") continue;
    }

    try {
      const resumableStatuses = ["discovered", "screened", "acquiring", "processing", "review_ready", "failed"] as const;
      const pending = await Promise.all(resumableStatuses.map((status) =>
        dependencies.repository.listCandidates({ sourceId: source.id, status, contentType, publicationStatus: "draft", limit })));
      const candidates = pending.flat().sort((left, right) => {
        // A hosted, fully reviewed video can publish immediately. Prioritize it
        // over older unhosted drafts so the daily run makes forward progress
        // instead of consuming its quota on candidates that must be hosted.
        const hostedRank = Number(hasHostedVideoAsset(right)) - Number(hasHostedVideoAsset(left));
        return hostedRank || left.lastActivityAt.getTime() - right.lastActivityAt.getTime();
      })
        .filter((candidate) => candidate.publicationStatus === "draft")
        .slice(0, limit);
      for (let offset = 0; offset < candidates.length; offset += reviewConcurrency) {
        const batch = candidates.slice(offset, offset + reviewConcurrency);
        await Promise.all(batch.map(async (candidate) => {
          try {
          const candidateSignal = AbortSignal.timeout(candidateTimeoutMs);
          const processed = input.requireBilingualSubtitles
            && dependencies.mediaRuntime
            && !hasBilingualSubtitleTimeline(candidate)
            ? await processDailyMediaCandidate({ repository: dependencies.repository, candidate, runtime: dependencies.mediaRuntime, now: dependencies.now, signal: candidateSignal })
            : candidate;
          const prepared = processed.status === "review_ready"
            ? processed
            : processed.contentType === "video"
              ? await prepareVideoCandidateForReview(dependencies.repository, processed.id, { now: dependencies.now })
              : await preparePodcastCandidateForReview(dependencies.repository, processed.id, { now: dependencies.now });
          if (candidate.status !== "review_ready") result.prepared += 1;
           if (prepared.status !== "review_ready") return;
          result.reviewReady += 1;
          if (input.mode === "review-only" || input.mode === "auto-publish") {
            if (!dependencies.reviewProviders) {
              if (input.mode === "auto-publish") {
                failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: "MEDIA_REVIEW_PROVIDER_UNAVAILABLE" });
              }
               return;
            }
            const existingReview = input.mode === "auto-publish"
              ? await dependencies.repository.getCandidateReview(prepared.id)
              : null;
            let review = existingReview && hasCurrentMediaApprovals(prepared, existingReview.reviews)
              ? { status: "approved" as const, reason: null }
              : await runMediaReview(dependencies.repository, { candidateId: prepared.id, contentProvider: dependencies.reviewProviders.content, teachingProvider: dependencies.reviewProviders.teaching });
            result.reviewed += 1;
            if (review.status === "approved") result.approved += 1;
            else if (review.status === "changes_requested") result.changesRequested += 1;
            else if (review.status === "rejected") result.rejected += 1;
            else failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: review.reason ?? "MEDIA_REVIEW_FAILED" });

            // One bounded metadata revision per run can repair summaries/CEFR labels;
            // rejected media remains terminal and is never reopened automatically.
            if (review.status === "changes_requested" && dependencies.reviewProviders.revision) {
              try {
                await reviseMediaCandidateAfterReview(dependencies.repository, {
                  candidateId: prepared.id,
                  revisionProvider: dependencies.reviewProviders.revision,
                  now: dependencies.now,
                });
                const revised = prepared.contentType === "video"
                  ? await prepareVideoCandidateForReview(dependencies.repository, prepared.id, { now: dependencies.now })
                  : await preparePodcastCandidateForReview(dependencies.repository, prepared.id, { now: dependencies.now });
                if (revised.status === "review_ready") {
                  result.prepared += 1;
                  result.reviewReady += 1;
                  review = await runMediaReview(dependencies.repository, { candidateId: revised.id, contentProvider: dependencies.reviewProviders.content, teachingProvider: dependencies.reviewProviders.teaching });
                  result.reviewed += 1;
                  if (review.status === "approved") result.approved += 1;
                  else if (review.status === "changes_requested") result.changesRequested += 1;
                  else if (review.status === "rejected") result.rejected += 1;
                  else failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: review.reason ?? "MEDIA_REVIEW_FAILED" });
                }
              } catch (error) {
                failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: errorCode(error) });
              }
            }
             if (input.mode !== "auto-publish" || review.status !== "approved") return;
            if (input.requireBilingualSubtitles && !hasBilingualSubtitleTimeline(prepared)) {
              result.skipped += 1;
              skippedReasons.MEDIA_BILINGUAL_SUBTITLES_REQUIRED = (skippedReasons.MEDIA_BILINGUAL_SUBTITLES_REQUIRED ?? 0) + 1;
              return;
            }
            if (!dependencies.publishers) {
              failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: "MEDIA_PUBLISHER_UNAVAILABLE" });
               return;
            }
            const publication = await autoPublishMediaCandidate(dependencies.repository, dependencies.publishers, { candidateId: prepared.id, actor: "media-auto-publication", runId: runKey, now: dependencies.now, requireBilingualSubtitles: input.requireBilingualSubtitles });
            if (publication.status === "published") {
              result.published += 1;
              result.publishedByType[contentType] += 1;
            }
            else if (publication.status === "skipped") {
              result.skipped += 1;
              const reason = publication.reason ?? "MEDIA_PUBLICATION_SKIPPED";
              skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
            }
            else failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: publication.reason ?? "MEDIA_PUBLICATION_FAILED" });
          }
          } catch (error) {
            failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: errorCode(error) });
          }
        }));
      }
    } catch (error) {
      failures.push({
        scope: "source",
        sourceStableKey: source.stableKey,
        code: errorCode(error),
      });
    }
  }
  return {
    ...empty(failures),
    ...result,
    videoDailyLimit,
    podcastDailyLimit,
    publishedByType: {
      video: previouslyPublished.video + result.publishedByType.video,
      podcast: previouslyPublished.podcast + result.publishedByType.podcast,
    },
    targetDeficitByType: {
      video: Math.max(0, videoDailyLimit - previouslyPublished.video - result.publishedByType.video),
      podcast: Math.max(0, podcastDailyLimit - previouslyPublished.podcast - result.publishedByType.podcast),
    },
    skippedReasons,
  };
}
