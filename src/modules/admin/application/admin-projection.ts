import { isOwnerUserId, ownerActorHash } from "@/src/shared/auth/owner";

import {
  computeCostCoverageRatio,
  computeFailureRate,
  toIsoStringOrNull,
} from "../domain/admin-console";
import type { AdminAuditRecord } from "../repositories/admin-audit-repository";
import type {
  AdminCandidateStatusCounts,
  AdminDiagnosticEventRecord,
  AdminProviderCallTotals,
  AdminUserAggregates,
  AdminUserRecord,
} from "../repositories/admin-read-repository";
import type {
  AdminAiAggregateDto,
  AdminAuditEntryDto,
  AdminCandidateBucketsDto,
  AdminDiagnosticEventDto,
  AdminUserCountsDto,
  AdminUserSummaryDto,
} from "../schemas/admin-console";

/**
 * Pure record -> DTO projections shared by the admin application use cases.
 *
 * Keeping the serialization here guarantees one shape for the list and detail
 * endpoints and makes the privacy boundary explicit: internal `profiles.id`
 * never leaves the repository (cursors are opaque), emails are only ever
 * masked, and audit actors are reduced to a stable non-reversible reference.
 */

const EMPTY_COUNTS: AdminUserCountsDto = {
  practiceSessions: 0,
  practiceAttempts: 0,
  evidenceEvents: 0,
  conversationMessages: 0,
  readingItems: 0,
  mediaItems: 0,
};

export function toAdminUserCounts(
  aggregates: AdminUserAggregates | undefined,
): AdminUserCountsDto {
  if (!aggregates) return { ...EMPTY_COUNTS };
  return {
    practiceSessions: aggregates.practiceSessions,
    practiceAttempts: aggregates.practiceAttempts,
    evidenceEvents: aggregates.evidenceEvents,
    conversationMessages: aggregates.conversationMessages,
    readingItems: aggregates.readingItems,
    mediaItems: aggregates.mediaItems,
  };
}

export function toAdminUserSummary(
  user: AdminUserRecord,
  aggregates: AdminUserAggregates | undefined,
): AdminUserSummaryDto {
  return {
    publicUid: user.publicUid,
    displayName: user.displayName,
    // Effective role: environment-bootstrap owners keep profiles.role='member',
    // but the owner console shows the authority they actually have.
    role: isOwnerUserId(user.id) ? "owner" : user.role,
    accountStatus: user.status,
    deletionPending: user.deletionRequestedAt !== null,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: toIsoStringOrNull(aggregates?.lastActiveAt ?? null),
    counts: toAdminUserCounts(aggregates),
  };
}

export function toCandidateBuckets(
  counts: AdminCandidateStatusCounts,
): AdminCandidateBucketsDto {
  return {
    discovered: counts.discovered,
    screened: counts.screened,
    acquiring: counts.acquiring,
    processing: counts.processing,
    reviewReady: counts.review_ready,
    failed: counts.failed,
    rejected: counts.rejected,
  };
}

export function toAiAggregate(
  totals: AdminProviderCallTotals,
): AdminAiAggregateDto {
  return {
    calls: totals.calls,
    succeeded: totals.succeeded,
    failed: totals.failed,
    cancelled: totals.cancelled,
    started: totals.started,
    failureRate: computeFailureRate(totals),
    p50LatencyMs: totals.p50LatencyMs,
    p95LatencyMs: totals.p95LatencyMs,
    estimatedCostMicros: totals.estimatedCostMicros,
    costUnknownCalls: totals.costUnknownCalls,
    costCoverageRatio: computeCostCoverageRatio({
      calls: totals.calls,
      callsWithCost: totals.calls - totals.costUnknownCalls,
    }),
  };
}

export function toDiagnosticEventDto(
  record: AdminDiagnosticEventRecord,
): AdminDiagnosticEventDto {
  return {
    id: record.id,
    eventType: record.eventType,
    severity: record.severity,
    status: record.status,
    errorType: record.errorType,
    occurredAt: record.occurredAt.toISOString(),
    acknowledgedAt: toIsoStringOrNull(record.acknowledgedAt),
    resolvedAt: toIsoStringOrNull(record.resolvedAt),
  };
}

/**
 * Audit rows carry only the actor's internal UUID; the console shows a stable
 * label plus a short non-reversible reference instead (design §5.5, §7).
 */
export function projectAdminAuditEntry(
  record: AdminAuditRecord,
  targetLabel: string | null,
): AdminAuditEntryDto {
  return {
    id: record.id,
    action: record.action,
    targetKind: record.targetKind,
    targetLabel,
    reason: record.reason,
    requestId: record.requestId,
    actor: {
      label: "project-owner",
      reference: ownerActorHash(record.actorUserId),
    },
    createdAt: record.createdAt.toISOString(),
  };
}
