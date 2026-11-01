import { readConfiguredOwnerUserIds } from "@/src/shared/auth/owner";

import {
  classifyAdminHealth,
  computeCostCoverageRatio,
  computeFailureRate,
  resolveAdminWindow,
  toIsoStringOrNull,
  type AdminWindow,
} from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminOverviewDataDto } from "../schemas/admin-console";
import { toCandidateBuckets } from "./admin-projection";

export type ReadAdminOverviewInput = Readonly<{
  window: AdminWindow;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}>;

/**
 * Operational overview for `/admin` (design §5.4).
 *
 * Counts, cost and health are operational metrics only: they are never learning
 * evidence and are not written anywhere.
 */
export async function readAdminOverview(
  repository: AdminReadRepository,
  input: ReadAdminOverviewInput,
): Promise<AdminOverviewDataDto> {
  const now = input.now ?? new Date();
  const range = resolveAdminWindow(input.window, now);
  const record = await repository.readOverview({
    from: range.from,
    to: range.to,
    now,
  });
  const totals = record.ai.totals;
  return {
    window: range.window,
    generatedAt: now.toISOString(),
    health: classifyAdminHealth({
      openDiagnostics: record.diagnostics.open,
      alertDiagnostics: record.diagnostics.alertsInWindow,
      storageCleanupFailed: record.diagnostics.storageCleanupFailed,
      failedAcquisitionRuns: record.acquisition.failedRuns,
      staleAcquisitionRuns: record.acquisition.runningStale,
    }),
    users: {
      total: record.users.total,
      newInWindow: record.users.newInWindow,
      activeInWindow: record.users.activeInWindow,
      suspended: record.users.suspended,
      // DB role owners plus the environment-bootstrap owner allowlist: an env
      // owner deliberately has no profiles.role='owner' row, so the raw DB count
      // alone would show 0 owners for the single-owner Alpha.
      owners: Math.max(
        record.users.owners,
        readConfiguredOwnerUserIds().length,
      ),
    },
    content: {
      published: {
        articles: record.content.published.articles,
        videos: record.content.published.videos,
        podcasts: record.content.published.podcasts,
      },
      candidates: toCandidateBuckets(record.content.candidates),
      reviewBacklog: record.content.reviewBacklog,
    },
    ai: {
      calls: totals.calls,
      failedCalls: totals.failed,
      failureRate: computeFailureRate(totals),
      p50LatencyMs: totals.p50LatencyMs,
      p95LatencyMs: totals.p95LatencyMs,
      estimatedCostMicros: totals.estimatedCostMicros,
      costCoverageRatio: computeCostCoverageRatio({
        calls: totals.calls,
        callsWithCost: totals.calls - totals.costUnknownCalls,
      }),
      costUnknownCalls: totals.costUnknownCalls,
      byProviderType: record.ai.byProviderType.map((provider) => ({
        providerType: provider.providerType,
        calls: provider.calls,
        failed: provider.failed,
        costMicros: provider.estimatedCostMicros,
        costUnknown: provider.costUnknownCalls,
      })),
    },
    acquisition: {
      runsInWindow: record.acquisition.runsInWindow,
      failedRuns: record.acquisition.failedRuns,
      runningStale: record.acquisition.runningStale,
      lastRunAt: toIsoStringOrNull(record.acquisition.lastRunAt),
    },
    diagnostics: {
      open: record.diagnostics.open,
      acknowledged: record.diagnostics.acknowledged,
      alertsInWindow: record.diagnostics.alertsInWindow,
      storageCleanupFailed: record.diagnostics.storageCleanupFailed,
    },
  };
}
