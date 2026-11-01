import {
  resolveAdminWindow,
  toIsoStringOrNull,
  type AdminWindow,
} from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminContentHealthDataDto } from "../schemas/admin-console";
import { toCandidateBuckets } from "./admin-projection";

export type ReadAdminContentHealthInput = Readonly<{
  window: AdminWindow;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}>;

/**
 * Content and acquisition health for `/admin/content-health` (design §5.4).
 *
 * Acquisition status uses only `acquisition_runs` / the candidate state; the
 * `content_pipeline_runs/steps` tables are reserved and unwritten, so they are
 * intentionally not reported. Media health is a read-only snapshot of currently
 * published versions; nothing here publishes, unpublishes or repairs content.
 */
export async function readAdminContentHealth(
  repository: AdminReadRepository,
  input: ReadAdminContentHealthInput,
): Promise<AdminContentHealthDataDto> {
  const now = input.now ?? new Date();
  const range = resolveAdminWindow(input.window, now);
  const record = await repository.readContentHealth({
    from: range.from,
    to: range.to,
    now,
  });
  const candidates = toCandidateBuckets(record.candidates);
  return {
    window: range.window,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    generatedAt: now.toISOString(),
    acquisition: {
      runsInWindow: record.acquisition.runsInWindow,
      succeededRuns: record.acquisition.succeededRuns,
      failedRuns: record.acquisition.failedRuns,
      cancelledRuns: record.acquisition.cancelledRuns,
      runningRuns: record.acquisition.runningRuns,
      runningStale: record.acquisition.runningStale,
      lastRunAt: toIsoStringOrNull(record.acquisition.lastRunAt),
      insertedCountInWindow: record.acquisition.insertedCountInWindow,
      duplicateCountInWindow: record.acquisition.duplicateCountInWindow,
    },
    candidates: {
      ...candidates,
      total:
        candidates.discovered +
        candidates.screened +
        candidates.acquiring +
        candidates.processing +
        candidates.reviewReady +
        candidates.failed +
        candidates.rejected,
    },
    reviewBacklog: candidates.reviewReady,
    published: {
      articles: record.published.articles,
      videos: record.published.videos,
      podcasts: record.published.podcasts,
    },
    media: {
      publishedVersions: record.media.publishedVersions,
      missingWordTimeline: record.media.missingWordTimeline,
      missingChineseTranslation: record.media.missingChineseTranslation,
      missingPlayableAsset: record.media.missingPlayableAsset,
      expiredPlaybackAsset: record.media.expiredPlaybackAsset,
      missingArtwork: record.media.missingArtwork,
      copyrightNotCleared: record.media.copyrightNotCleared,
      transcriptBackfillPending: record.media.transcriptBackfillPending,
    },
    corpus: {
      occurrences: record.corpus.occurrences,
      occurrencesInWindow: record.corpus.occurrencesInWindow,
      lastIndexedAt: toIsoStringOrNull(record.corpus.lastIndexedAt),
    },
  };
}
