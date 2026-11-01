import { z } from "zod";

import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_TARGET_KINDS } from "../domain/admin-audit";
import {
  ADMIN_MAX_PAGE_LIMIT,
  ADMIN_MAX_RANGE_MS,
  ADMIN_USER_ROLES,
  ADMIN_USER_STATUSES,
  ADMIN_WINDOWS,
  DIAGNOSTIC_EVENT_TYPES,
  DIAGNOSTIC_SEVERITIES,
  DIAGNOSTIC_STATUSES,
} from "../domain/admin-console";

/**
 * Single source of truth for the owner-console request/response DTOs
 * (ACCT-ADMIN-001 slice B, design §5.4).
 *
 * The JSON Schemas under `contracts/schemas/v1/admin-*.schema.json` mirror these
 * shapes for external contract tests; route handlers and the U1 pages consume
 * the inferred types. Every object is strict so an accidental extra field (for
 * example an internal id or a chat body) fails loudly instead of leaking.
 */

const isoDateTime = z.iso.datetime();
const nullableIsoDateTime = isoDateTime.nullable();
const count = z.number().int().nonnegative();
const nullableCount = z.number().int().nonnegative().nullable();
const ratio = z.number().min(0).max(1);
const publicUidSchema = z
  .string()
  .regex(/^SN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u);
const providerTypeSchema = z.string().trim().min(1).max(80);
const providerSchema = z.string().trim().min(1).max(120);
const errorTypeSchema = z.string().trim().min(1).max(120);

export const ADMIN_ACCOUNT_ACTIONS = ["acknowledged", "resolved"] as const;

/* -------------------------------------------------------------------------- */
/* Queries and request bodies                                                 */
/* -------------------------------------------------------------------------- */

export const adminOverviewQuerySchema = z.strictObject({
  window: z.enum(ADMIN_WINDOWS).default("7d"),
});

export const adminUsersQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(ADMIN_USER_STATUSES).optional(),
  role: z.enum(ADMIN_USER_ROLES).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_LIMIT).default(20),
});

export const adminUserParamsSchema = z.strictObject({
  publicUid: publicUidSchema,
});

function timeRangeRefinement(value: { from?: string; to?: string }): boolean {
  if (!value.from || !value.to) return true;
  const from = new Date(value.from).getTime();
  const to = new Date(value.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return from <= to && to - from <= ADMIN_MAX_RANGE_MS;
}

export const adminAiUsageQuerySchema = z
  .strictObject({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    providerType: providerTypeSchema.optional(),
    provider: providerSchema.optional(),
  })
  .refine(timeRangeRefinement, {
    message: "The requested time range must be ordered and at most 90 days long.",
    path: ["to"],
  });

export const adminContentHealthQuerySchema = z.strictObject({
  window: z.enum(ADMIN_WINDOWS).default("7d"),
});

export const adminDiagnosticsQuerySchema = z.strictObject({
  status: z.enum(DIAGNOSTIC_STATUSES).optional(),
  severity: z.enum(DIAGNOSTIC_SEVERITIES).optional(),
  eventType: z.enum(DIAGNOSTIC_EVENT_TYPES).optional(),
  since: z.iso.datetime({ offset: true }).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_LIMIT).default(20),
});

export const adminDiagnosticEventParamsSchema = z.strictObject({
  eventId: z.uuid(),
});

export const adminDiagnosticUpdateSchema = z.strictObject({
  status: z.enum(ADMIN_ACCOUNT_ACTIONS),
  reason: z.string().trim().min(4).max(500),
});

export const adminAuditLogQuerySchema = z.strictObject({
  action: z.enum(ADMIN_AUDIT_ACTIONS).optional(),
  targetKind: z.enum(ADMIN_AUDIT_TARGET_KINDS).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(ADMIN_MAX_PAGE_LIMIT).default(20),
});

/* -------------------------------------------------------------------------- */
/* Shared response shapes                                                     */
/* -------------------------------------------------------------------------- */

export const adminAuditEntrySchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(ADMIN_AUDIT_ACTIONS),
  targetKind: z.enum(ADMIN_AUDIT_TARGET_KINDS),
  /** Public UID, masked invited email or diagnostic event type; never an internal UUID. */
  targetLabel: z.string().max(200).nullable(),
  reason: z.string().max(500).nullable(),
  requestId: z.string().max(128).nullable(),
  actor: z.strictObject({
    label: z.literal("project-owner"),
    /** Non-reversible short hash so several future owners stay distinguishable. */
    reference: z.string().regex(/^[a-f0-9]{16}$/u),
  }),
  createdAt: isoDateTime,
});

export const adminUserCountsSchema = z.strictObject({
  practiceSessions: count,
  practiceAttempts: count,
  evidenceEvents: count,
  conversationMessages: count,
  readingItems: count,
  mediaItems: count,
});

export const adminUserSummarySchema = z.strictObject({
  publicUid: publicUidSchema,
  displayName: z.string().max(200).nullable(),
  role: z.enum(ADMIN_USER_ROLES),
  accountStatus: z.enum(ADMIN_USER_STATUSES),
  deletionPending: z.boolean(),
  createdAt: isoDateTime,
  lastActiveAt: nullableIsoDateTime,
  counts: adminUserCountsSchema,
});

export const adminCandidateBucketsSchema = z.strictObject({
  discovered: count,
  screened: count,
  acquiring: count,
  processing: count,
  reviewReady: count,
  failed: count,
  rejected: count,
});

export const adminAiAggregateSchema = z.strictObject({
  calls: count,
  succeeded: count,
  failed: count,
  cancelled: count,
  /** Calls still in `started`; excluded from the failure rate denominator. */
  started: count,
  failureRate: ratio.nullable(),
  p50LatencyMs: nullableCount,
  p95LatencyMs: nullableCount,
  estimatedCostMicros: count,
  costUnknownCalls: count,
  costCoverageRatio: ratio.nullable(),
});

export const adminAiProviderTypeAggregateSchema = adminAiAggregateSchema.extend({
  providerType: providerTypeSchema,
});

export const adminAiProviderAggregateSchema = adminAiAggregateSchema.extend({
  provider: providerSchema,
  providerType: providerTypeSchema,
});

export const adminAiDayAggregateSchema = z.strictObject({
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  calls: count,
  failed: count,
  estimatedCostMicros: count,
  costUnknownCalls: count,
});

export const adminAiErrorAggregateSchema = z.strictObject({
  errorType: errorTypeSchema,
  count,
});

export const adminSafetyGateSchema = z.strictObject({
  conversationBlockedGenerations: count,
  proactiveBlockedCandidates: count,
});

/* -------------------------------------------------------------------------- */
/* Response payloads                                                          */
/* -------------------------------------------------------------------------- */

export const adminOverviewDataSchema = z.strictObject({
  window: z.enum(ADMIN_WINDOWS),
  generatedAt: isoDateTime,
  health: z.enum(["healthy", "degraded", "critical"]),
  users: z.strictObject({
    total: count,
    newInWindow: count,
    activeInWindow: count,
    suspended: count,
    owners: count,
  }),
  content: z.strictObject({
    published: z.strictObject({
      articles: count,
      videos: count,
      podcasts: count,
    }),
    candidates: adminCandidateBucketsSchema,
    reviewBacklog: count,
  }),
  ai: z.strictObject({
    calls: count,
    failedCalls: count,
    failureRate: ratio.nullable(),
    p50LatencyMs: nullableCount,
    p95LatencyMs: nullableCount,
    estimatedCostMicros: count,
    costCoverageRatio: ratio.nullable(),
    costUnknownCalls: count,
    byProviderType: z
      .array(
        z.strictObject({
          providerType: providerTypeSchema,
          calls: count,
          failed: count,
          costMicros: count,
          costUnknown: count,
        }),
      )
      .max(50),
  }),
  acquisition: z.strictObject({
    runsInWindow: count,
    failedRuns: count,
    runningStale: count,
    lastRunAt: nullableIsoDateTime,
  }),
  diagnostics: z.strictObject({
    open: count,
    acknowledged: count,
    alertsInWindow: count,
    storageCleanupFailed: count,
  }),
});

export const adminUserListDataSchema = z.strictObject({
  users: z.array(adminUserSummarySchema).max(ADMIN_MAX_PAGE_LIMIT),
});

export const adminInvitationSourceSchema = z.strictObject({
  invitationId: z.uuid(),
  /** Masked local part only, for example `a***@example.com`. */
  emailMasked: z.string().min(3).max(330),
  role: z.enum(ADMIN_USER_ROLES),
  status: z.enum([
    "pending",
    "redeeming",
    "accepted",
    "expired",
    "revoked",
    "failed",
  ]),
  createdAt: isoDateTime,
  acceptedAt: nullableIsoDateTime,
});

export const adminUserDetailDataSchema = z.strictObject({
  user: adminUserSummarySchema,
  invitation: adminInvitationSourceSchema.nullable(),
  recentAudit: z.array(adminAuditEntrySchema).max(20),
});

export const adminAiUsageDataSchema = z.strictObject({
  from: isoDateTime,
  to: isoDateTime,
  generatedAt: isoDateTime,
  providerType: providerTypeSchema.nullable(),
  provider: providerSchema.nullable(),
  totals: adminAiAggregateSchema,
  byProviderType: z.array(adminAiProviderTypeAggregateSchema).max(50),
  byProvider: z.array(adminAiProviderAggregateSchema).max(100),
  // A 90-day inclusive range can touch 91 UTC calendar days; 92 keeps the cap.
  byDay: z.array(adminAiDayAggregateSchema).max(92),
  topErrorTypes: z.array(adminAiErrorAggregateSchema).max(10),
  safetyGate: adminSafetyGateSchema,
});

export const adminContentHealthDataSchema = z.strictObject({
  window: z.enum(ADMIN_WINDOWS),
  from: isoDateTime,
  to: isoDateTime,
  generatedAt: isoDateTime,
  acquisition: z.strictObject({
    runsInWindow: count,
    succeededRuns: count,
    failedRuns: count,
    cancelledRuns: count,
    runningRuns: count,
    runningStale: count,
    lastRunAt: nullableIsoDateTime,
    insertedCountInWindow: count,
    duplicateCountInWindow: count,
  }),
  candidates: adminCandidateBucketsSchema.extend({ total: count }),
  reviewBacklog: count,
  published: z.strictObject({
    articles: count,
    videos: count,
    podcasts: count,
  }),
  media: z.strictObject({
    publishedVersions: count,
    missingWordTimeline: count,
    missingChineseTranslation: count,
    missingPlayableAsset: count,
    expiredPlaybackAsset: count,
    missingArtwork: count,
    copyrightNotCleared: count,
    transcriptBackfillPending: count,
  }),
  corpus: z.strictObject({
    occurrences: count,
    occurrencesInWindow: count,
    lastIndexedAt: nullableIsoDateTime,
  }),
});

export const adminDiagnosticEventSchema = z.strictObject({
  id: z.uuid(),
  eventType: z.enum(DIAGNOSTIC_EVENT_TYPES),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  status: z.enum(DIAGNOSTIC_STATUSES),
  errorType: errorTypeSchema.nullable(),
  occurredAt: isoDateTime,
  acknowledgedAt: nullableIsoDateTime,
  resolvedAt: nullableIsoDateTime,
});

export const adminDiagnosticsAggregateSchema = z.strictObject({
  open: count,
  acknowledged: count,
  resolved: count,
  byEventType: z
    .array(
      z.strictObject({
        eventType: z.enum(DIAGNOSTIC_EVENT_TYPES),
        open: count,
        total: count,
      }),
    )
    .max(DIAGNOSTIC_EVENT_TYPES.length),
  storageCleanupFailed: count,
});

export const adminDiagnosticsDataSchema = z.strictObject({
  events: z.array(adminDiagnosticEventSchema).max(ADMIN_MAX_PAGE_LIMIT),
  aggregate: adminDiagnosticsAggregateSchema,
});

export const adminDiagnosticUpdateDataSchema = z.strictObject({
  event: adminDiagnosticEventSchema,
  auditRecorded: z.boolean(),
});

export const adminAuditLogDataSchema = z.strictObject({
  entries: z.array(adminAuditEntrySchema).max(ADMIN_MAX_PAGE_LIMIT),
});

/* -------------------------------------------------------------------------- */
/* Inferred types consumed by application code and the U1 pages                */
/* -------------------------------------------------------------------------- */

export type AdminOverviewQuery = z.infer<typeof adminOverviewQuerySchema>;
export type AdminUsersQuery = z.infer<typeof adminUsersQuerySchema>;
export type AdminUserParams = z.infer<typeof adminUserParamsSchema>;
export type AdminAiUsageQuery = z.infer<typeof adminAiUsageQuerySchema>;
export type AdminContentHealthQuery = z.infer<typeof adminContentHealthQuerySchema>;
export type AdminDiagnosticsQuery = z.infer<typeof adminDiagnosticsQuerySchema>;
export type AdminDiagnosticEventParams = z.infer<
  typeof adminDiagnosticEventParamsSchema
>;
export type AdminDiagnosticUpdateInput = z.infer<
  typeof adminDiagnosticUpdateSchema
>;
export type AdminAuditLogQuery = z.infer<typeof adminAuditLogQuerySchema>;

export type AdminAuditEntryDto = z.infer<typeof adminAuditEntrySchema>;
export type AdminUserCountsDto = z.infer<typeof adminUserCountsSchema>;
export type AdminUserSummaryDto = z.infer<typeof adminUserSummarySchema>;
export type AdminCandidateBucketsDto = z.infer<
  typeof adminCandidateBucketsSchema
>;
export type AdminAiAggregateDto = z.infer<typeof adminAiAggregateSchema>;
export type AdminAiProviderTypeAggregateDto = z.infer<
  typeof adminAiProviderTypeAggregateSchema
>;
export type AdminAiProviderAggregateDto = z.infer<
  typeof adminAiProviderAggregateSchema
>;
export type AdminAiDayAggregateDto = z.infer<typeof adminAiDayAggregateSchema>;
export type AdminAiErrorAggregateDto = z.infer<
  typeof adminAiErrorAggregateSchema
>;
export type AdminSafetyGateDto = z.infer<typeof adminSafetyGateSchema>;

export type AdminOverviewDataDto = z.infer<typeof adminOverviewDataSchema>;
export type AdminUserListDataDto = z.infer<typeof adminUserListDataSchema>;
export type AdminInvitationSourceDto = z.infer<
  typeof adminInvitationSourceSchema
>;
export type AdminUserDetailDataDto = z.infer<typeof adminUserDetailDataSchema>;
export type AdminAiUsageDataDto = z.infer<typeof adminAiUsageDataSchema>;
export type AdminContentHealthDataDto = z.infer<
  typeof adminContentHealthDataSchema
>;
export type AdminDiagnosticEventDto = z.infer<typeof adminDiagnosticEventSchema>;
export type AdminDiagnosticsAggregateDto = z.infer<
  typeof adminDiagnosticsAggregateSchema
>;
export type AdminDiagnosticsDataDto = z.infer<typeof adminDiagnosticsDataSchema>;
export type AdminDiagnosticUpdateDataDto = z.infer<
  typeof adminDiagnosticUpdateDataSchema
>;
export type AdminAuditLogDataDto = z.infer<typeof adminAuditLogDataSchema>;
