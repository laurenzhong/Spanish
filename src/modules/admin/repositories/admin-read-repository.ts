import type { AccountRole, AccountStatus } from "@/src/shared/auth/account-access";

import type {
  AdminCandidateStatus,
  AdminCursor,
  DiagnosticEventType,
  DiagnosticSeverity,
  DiagnosticStatus,
} from "../domain/admin-console";
import type { AdminAuditRecord } from "./admin-audit-repository";

/**
 * Read port for the owner regulatory console (ACCT-ADMIN-001 slice B).
 *
 * This module owns no business data: every method is a read-only SQL projection
 * over tables owned by other modules (design §5.4 / ADR-0021 §8). The single
 * exception is the owner triage status on `diagnostic_events` (see
 * `transitionDiagnosticEvent`): acknowledge/resolve is the limited management
 * action assigned to this slice and the only write besides `admin_audit_log`.
 */

/** A `running` acquisition run older than this is reported as stale. */
export const ADMIN_ACQUISITION_STALE_AFTER_MS = 60 * 60 * 1_000;

/** Stable provider error type used by the conversation safety gate. */
export const SAFETY_GATE_ERROR_TYPE = "safety-gate";

/** Provider call types that write `provider_calls` today (TTX/STT do not yet). */
export const ADMIN_AI_COST_NOTE =
  "estimated cost only covers provider calls that persist estimated_cost_micros";

export type AdminUserRecord = Readonly<{
  /** Internal profile id: joins only. It must never reach a response DTO. */
  id: string;
  publicUid: string;
  displayName: string | null;
  role: AccountRole;
  status: AccountStatus;
  createdAt: Date;
  deletionRequestedAt: Date | null;
}>;

export type AdminUserAggregates = Readonly<{
  lastActiveAt: Date | null;
  practiceSessions: number;
  practiceAttempts: number;
  evidenceEvents: number;
  conversationMessages: number;
  readingItems: number;
  mediaItems: number;
}>;

export type AdminUsersListInput = Readonly<{
  q?: string;
  status?: AccountStatus;
  role?: AccountRole;
  cursor?: AdminCursor;
  limit: number;
}>;

export type AdminUsersPageRecord = Readonly<{
  users: readonly AdminUserRecord[];
  hasMore: boolean;
  /** Encoded opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null;
}>;

export type AdminInvitationSourceRecord = Readonly<{
  id: string;
  /** Normalized invited email; the application masks it before returning. */
  email: string;
  role: AccountRole;
  status: string;
  createdAt: Date;
  acceptedAt: Date | null;
}>;

export type AdminCandidateStatusCounts = Readonly<
  Record<AdminCandidateStatus, number>
>;

export type AdminPublishedContentCounts = Readonly<{
  articles: number;
  videos: number;
  podcasts: number;
}>;

export type AdminUserStatistics = Readonly<{
  total: number;
  newInWindow: number;
  activeInWindow: number;
  suspended: number;
  owners: number;
}>;

export type AdminProviderCallTotals = Readonly<{
  calls: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  /** Calls still in flight (`started`); excluded from failure rate. */
  started: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  estimatedCostMicros: number;
  costUnknownCalls: number;
}>;

export type AdminProviderTypeTotals = AdminProviderCallTotals &
  Readonly<{ providerType: string }>;

export type AdminProviderTotals = AdminProviderCallTotals &
  Readonly<{ provider: string; providerType: string }>;

export type AdminAiDayTotals = Readonly<{
  /** UTC calendar day (`YYYY-MM-DD`). */
  date: string;
  calls: number;
  failed: number;
  estimatedCostMicros: number;
  costUnknownCalls: number;
}>;

export type AdminAiErrorTotals = Readonly<{
  errorType: string;
  count: number;
}>;

export type AdminSafetyGateRecord = Readonly<{
  conversationBlockedGenerations: number;
  proactiveBlockedCandidates: number;
}>;

export type AdminAcquisitionOverviewRecord = Readonly<{
  runsInWindow: number;
  failedRuns: number;
  runningStale: number;
  lastRunAt: Date | null;
}>;

export type AdminDiagnosticsOverviewRecord = Readonly<{
  open: number;
  acknowledged: number;
  alertsInWindow: number;
  storageCleanupFailed: number;
}>;

export type AdminOverviewRecord = Readonly<{
  users: AdminUserStatistics;
  content: Readonly<{
    published: AdminPublishedContentCounts;
    candidates: AdminCandidateStatusCounts;
    reviewBacklog: number;
  }>;
  ai: Readonly<{
    totals: AdminProviderCallTotals;
    byProviderType: readonly AdminProviderTypeTotals[];
  }>;
  acquisition: AdminAcquisitionOverviewRecord;
  diagnostics: AdminDiagnosticsOverviewRecord;
}>;

export type AdminAiUsageQueryRecord = Readonly<{
  from: Date;
  to: Date;
  providerType?: string;
  provider?: string;
}>;

export type AdminAiUsageRecord = Readonly<{
  totals: AdminProviderCallTotals;
  byProviderType: readonly AdminProviderTypeTotals[];
  byProvider: readonly AdminProviderTotals[];
  byDay: readonly AdminAiDayTotals[];
  topErrorTypes: readonly AdminAiErrorTotals[];
  safetyGate: AdminSafetyGateRecord;
}>;

export type AdminAcquisitionHealthRecord = Readonly<{
  runsInWindow: number;
  succeededRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  runningRuns: number;
  runningStale: number;
  lastRunAt: Date | null;
  insertedCountInWindow: number;
  duplicateCountInWindow: number;
}>;

export type AdminMediaHealthRecord = Readonly<{
  publishedVersions: number;
  missingWordTimeline: number;
  missingChineseTranslation: number;
  missingPlayableAsset: number;
  expiredPlaybackAsset: number;
  missingArtwork: number;
  copyrightNotCleared: number;
  transcriptBackfillPending: number;
}>;

export type AdminCorpusFreshnessRecord = Readonly<{
  occurrences: number;
  occurrencesInWindow: number;
  lastIndexedAt: Date | null;
}>;

export type AdminContentHealthRecord = Readonly<{
  acquisition: AdminAcquisitionHealthRecord;
  candidates: AdminCandidateStatusCounts;
  published: AdminPublishedContentCounts;
  media: AdminMediaHealthRecord;
  corpus: AdminCorpusFreshnessRecord;
}>;

export type AdminDiagnosticEventRecord = Readonly<{
  id: string;
  eventType: DiagnosticEventType;
  severity: DiagnosticSeverity;
  status: DiagnosticStatus;
  errorType: string | null;
  occurredAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
}>;

export type AdminDiagnosticsAggregateRecord = Readonly<{
  open: number;
  acknowledged: number;
  resolved: number;
  byEventType: readonly Readonly<{
    eventType: DiagnosticEventType;
    open: number;
    total: number;
  }>[];
  storageCleanupFailed: number;
}>;

export type AdminDiagnosticsListInput = Readonly<{
  status?: DiagnosticStatus;
  severity?: DiagnosticSeverity;
  eventType?: DiagnosticEventType;
  since?: Date;
  cursor?: AdminCursor;
  limit: number;
}>;

export type AdminDiagnosticsPageRecord = Readonly<{
  events: readonly AdminDiagnosticEventRecord[];
  hasMore: boolean;
  /** Encoded opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null;
  /** Aggregate across all diagnostic events, independent of the list filters. */
  aggregate: AdminDiagnosticsAggregateRecord;
}>;

export type AdminDiagnosticTransitionInput = Readonly<{
  eventId: string;
  status: "acknowledged" | "resolved";
  now: Date;
}>;

export type AdminAuditListInput = Readonly<{
  action?: string;
  targetKind?: string;
  cursor?: AdminCursor;
  limit: number;
}>;

export type AdminAuditEntriesPageRecord = Readonly<{
  entries: readonly AdminAuditRecord[];
  hasMore: boolean;
  /** Encoded opaque cursor for the next page, or `null` at the end. */
  nextCursor: string | null;
}>;

export type AdminUserAuditInput = Readonly<{
  /** Internal profile id used only to match an audit row's stored target id. */
  userId: string;
  publicUid: string;
  limit: number;
}>;

export interface AdminReadRepository {
  listUsers(input: AdminUsersListInput): Promise<AdminUsersPageRecord>;
  loadUserAggregates(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminUserAggregates>>;
  findUserByPublicUid(publicUid: string): Promise<AdminUserRecord | null>;
  findUserInvitationSource(
    userId: string,
  ): Promise<AdminInvitationSourceRecord | null>;
  /** Latest audit rows targeting this user (either stored by public UID or id). */
  listUserAuditEntries(
    input: AdminUserAuditInput,
  ): Promise<readonly AdminAuditRecord[]>;
  readOverview(input: Readonly<{ from: Date; to: Date; now: Date }>): Promise<AdminOverviewRecord>;
  readAiUsage(input: AdminAiUsageQueryRecord): Promise<AdminAiUsageRecord>;
  readContentHealth(
    input: Readonly<{ from: Date; to: Date; now: Date }>,
  ): Promise<AdminContentHealthRecord>;
  listDiagnostics(
    input: AdminDiagnosticsListInput,
  ): Promise<AdminDiagnosticsPageRecord>;
  findDiagnosticEvent(eventId: string): Promise<AdminDiagnosticEventRecord | null>;
  /**
   * Atomic triage transition. Returns `null` when the event does not exist or
   * the requested transition is not legal (`open -> acknowledged`,
   * `acknowledged -> resolved` only); the caller distinguishes the two cases.
   */
  transitionDiagnosticEvent(
    input: AdminDiagnosticTransitionInput,
  ): Promise<AdminDiagnosticEventRecord | null>;
  listAuditEntries(input: AdminAuditListInput): Promise<AdminAuditEntriesPageRecord>;
  /**
   * Resolve a stable, non-sensitive label per audit target so the DTO never has
   * to expose internal ids: public UID for users, masked email for invitations,
   * event type for diagnostic events. Key is `${targetKind}:${targetId}`.
   */
  resolveAuditTargetLabels(
    entries: readonly AdminAuditRecord[],
  ): Promise<ReadonlyMap<string, string>>;
}
