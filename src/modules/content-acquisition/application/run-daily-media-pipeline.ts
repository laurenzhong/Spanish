import type { ContentSourceAdapter } from "../adapters";
import type { ContentAcquisitionRepository, ContentSourceRecord, ContentWorkflowRepository } from "../repositories";
import { preparePodcastCandidateForReview } from "./prepare-podcast-candidate-for-review";
import { prepareVideoCandidateForReview } from "./prepare-video-candidate-for-review";
import { runAcquisitionSource } from "./run-acquisition-source";

export const mediaPublicationModes = ["disabled", "discover-only", "review-only"] as const;
export type MediaPublicationMode = typeof mediaPublicationModes[number];

type DailyMediaRepository = ContentAcquisitionRepository & ContentWorkflowRepository;

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
  discovered: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  prepared: number;
  reviewReady: number;
  skippedSources: readonly Readonly<{ sourceStableKey: string; reason: string }>[];
  failures: readonly DailyMediaPipelineFailure[];
}>;

export type RunDailyMediaPipelineDependencies = Readonly<{
  repository: DailyMediaRepository;
  resolveAdapter: (source: ContentSourceRecord) => ContentSourceAdapter | Promise<ContentSourceAdapter>;
  now?: () => Date;
}>;

function errorCode(error: unknown): string {
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

export async function runDailyMediaPipeline(
  dependencies: RunDailyMediaPipelineDependencies,
  input: Readonly<{
    date?: string;
    mode: MediaPublicationMode;
    dailyLimit: number;
    defaultSourceLimit: number;
  }>,
): Promise<DailyMediaPipelineResult> {
  const date = input.date ?? naturalDate((dependencies.now ?? (() => new Date()))());
  const sources = await dependencies.repository.listSources();
  const skippedSources = sources
    .filter((source) => isMediaSource(source) && source.enabled && source.rightsStatus !== "verified")
    .map((source) => ({ sourceStableKey: source.stableKey, reason: "RIGHTS_NOT_VERIFIED" }));
  const eligible = sources
    .filter((source) => isMediaSource(source) && source.enabled && source.rightsStatus === "verified")
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  const runKey = `media-daily:${date}`;
  const empty = (failures: readonly DailyMediaPipelineFailure[] = []): DailyMediaPipelineResult => ({
    runKey,
    mode: input.mode,
    dailyLimit: input.dailyLimit,
    discovered: 0,
    inserted: 0,
    duplicates: 0,
    conflicts: 0,
    prepared: 0,
    reviewReady: 0,
    skippedSources,
    failures,
  });
  if (input.mode === "disabled" || input.dailyLimit === 0) return empty();

  const result = { discovered: 0, inserted: 0, duplicates: 0, conflicts: 0, prepared: 0, reviewReady: 0 };
  const failures: DailyMediaPipelineFailure[] = [];
  let remaining = input.dailyLimit;
  for (const source of eligible) {
    if (remaining <= 0) break;
    const limit = Math.min(input.defaultSourceLimit, remaining);
    try {
      const adapter = await dependencies.resolveAdapter(source);
      const acquisition = await runAcquisitionSource({
        repository: dependencies.repository,
        adapter,
        input: { sourceStableKey: source.stableKey, dryRun: false, limit },
      });
      result.discovered += acquisition.discovered;
      result.inserted += acquisition.inserted;
      result.duplicates += acquisition.duplicates;
      result.conflicts += acquisition.conflicts;
      remaining -= acquisition.inserted;
      if (input.mode === "discover-only") continue;

      const contentType = source.sourceKind === "video-channel" ? "video" : "podcast";
      const pending = await dependencies.repository.listCandidates({ sourceId: source.id, limit, contentType });
      const candidates = pending.filter((candidate) => candidate.status === "discovered").slice(0, limit);
      for (const candidate of candidates) {
        try {
          const prepared = candidate.contentType === "video"
            ? await prepareVideoCandidateForReview(dependencies.repository, candidate.id)
            : await preparePodcastCandidateForReview(dependencies.repository, candidate.id);
          result.prepared += 1;
          if (prepared.status === "review_ready") result.reviewReady += 1;
        } catch (error) {
          failures.push({ scope: "candidate", sourceStableKey: source.stableKey, candidateId: candidate.id, code: errorCode(error) });
        }
      }
    } catch (error) {
      failures.push({ scope: "source", sourceStableKey: source.stableKey, code: errorCode(error) });
    }
  }
  return { ...empty(failures), ...result };
}
