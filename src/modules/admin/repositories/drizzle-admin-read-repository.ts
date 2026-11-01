import { sql, type SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { AccountRole, AccountStatus } from "@/src/shared/auth/account-access";
import * as schema from "@/src/shared/db/schema";

import {
  ACQUISITION_RUN_STALE_AFTER_MS,
  ADMIN_CANDIDATE_STATUSES,
  buildLikeContainsPattern,
  encodeAdminCursor,
  maskEmail,
  type AdminCandidateStatus,
  type DiagnosticEventType,
  type DiagnosticSeverity,
  type DiagnosticStatus,
} from "../domain/admin-console";
import type {
  AdminAuditAction,
  AdminAuditTargetKind,
} from "../domain/admin-audit";
import type { AdminAuditRecord } from "./admin-audit-repository";
import {
  SAFETY_GATE_ERROR_TYPE,
  type AdminAcquisitionHealthRecord,
  type AdminAiDayTotals,
  type AdminAiErrorTotals,
  type AdminAiUsageQueryRecord,
  type AdminAiUsageRecord,
  type AdminAuditEntriesPageRecord,
  type AdminAuditListInput,
  type AdminCandidateStatusCounts,
  type AdminContentHealthRecord,
  type AdminCorpusFreshnessRecord,
  type AdminDiagnosticEventRecord,
  type AdminDiagnosticsAggregateRecord,
  type AdminDiagnosticsListInput,
  type AdminDiagnosticsPageRecord,
  type AdminDiagnosticTransitionInput,
  type AdminInvitationSourceRecord,
  type AdminMediaHealthRecord,
  type AdminOverviewRecord,
  type AdminProviderCallTotals,
  type AdminProviderTotals,
  type AdminReadRepository,
  type AdminSafetyGateRecord,
  type AdminUserAggregates,
  type AdminUserAuditInput,
  type AdminUserRecord,
  type AdminUsersListInput,
  type AdminUsersPageRecord,
} from "./admin-read-repository";

/**
 * Drizzle implementation of the owner-console read port.
 *
 * Every statement is a SELECT projection over tables owned by other modules
 * (design 搂5.4 / ADR-0021 搂8). The only writes are the diagnostic triage
 * transition (the limited management action of this slice) and the audit row
 * written by the admin application; no other module's data is modified.
 *
 * Aggregation notes:
 *   - latencies use `percentile_cont` restricted to succeeded calls;
 *   - failure rate excludes in-flight `started` calls;
 *   - costs are sparse by design, so counts and coverage are returned together;
 *   - `content_pipeline_runs/steps` are intentionally not read (unused tables).
 */

type AdminDatabase<TResult extends PgQueryResultHKT> = PgDatabase<TResult, typeof schema>;

/** Render a timestamptz as a fixed-width UTC string with microsecond precision. */
function cursorKey(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Unwrap a raw `execute()` result.
 *
 * The production postgres-js driver returns rows directly, while drizzle's
 * PGlite driver returns `{ rows, fields }`. Normalising here keeps callers and
 * tests driver-agnostic.
 */
function unwrapRows<T>(result: unknown): readonly T[] {
  if (Array.isArray(result)) return result as readonly T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as readonly T[]) : [];
}

function asCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function asNullableLatency(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toRequiredDate(value: unknown, field: string): Date {
  const parsed = toDate(value);
  if (!parsed) {
    throw new Error(`admin-read-repository: ${field} is missing from the database row.`);
  }
  return parsed;
}

function emptyCandidateCounts(): Record<AdminCandidateStatus, number> {
  return {
    discovered: 0,
    screened: 0,
    acquiring: 0,
    processing: 0,
    review_ready: 0,
    failed: 0,
    rejected: 0,
  };
}

function toCandidateCounts(
  rows: readonly Readonly<{ status: string; n: unknown }>[],
): AdminCandidateStatusCounts {
  const counts = emptyCandidateCounts();
  for (const row of rows) {
    if (isCandidateStatus(row.status)) {
      counts[row.status] = asCount(row.n);
    }
  }
  return counts;
}

function isCandidateStatus(value: string): value is AdminCandidateStatus {
  return (ADMIN_CANDIDATE_STATUSES as readonly string[]).includes(value);
}

function toProviderTotals(row: RawProviderTotalsRow): AdminProviderCallTotals {
  return {
    calls: asCount(row.calls),
    succeeded: asCount(row.succeeded),
    failed: asCount(row.failed),
    cancelled: asCount(row.cancelled),
    started: asCount(row.started),
    p50LatencyMs: asNullableLatency(row.p50_latency_ms),
    p95LatencyMs: asNullableLatency(row.p95_latency_ms),
    estimatedCostMicros: asCount(row.estimated_cost_micros),
    costUnknownCalls: asCount(row.cost_known_calls),
  };
}

type RawProviderTotalsRow = Readonly<{
  calls: unknown;
  succeeded: unknown;
  failed: unknown;
  cancelled: unknown;
  started: unknown;
  p50_latency_ms: unknown;
  p95_latency_ms: unknown;
  estimated_cost_micros: unknown;
  /** Rows that DID record a cost; the DTO derives the unknown count. */
  cost_known_calls: unknown;
}>;

/**
 * Cost coverage DTO wants the number of calls *without* a cost. The SQL returns
 * the known count because it is cheaper to count non-null rows; convert here.
 * Generic so grouped rows keep their extra dimensions (provider/providerType).
 */
function providerCostUnknown<T extends AdminProviderCallTotals>(totals: T): T {
  return {
    ...totals,
    costUnknownCalls: Math.max(0, totals.calls - totals.costUnknownCalls),
  };
}

function toDiagnosticEvent(row: RawDiagnosticEventRow): AdminDiagnosticEventRecord {
  return {
    id: String(row.id),
    eventType: row.event_type as DiagnosticEventType,
    severity: row.severity as DiagnosticSeverity,
    status: row.status as DiagnosticStatus,
    errorType: row.error_type === null || row.error_type === undefined
      ? null
      : String(row.error_type),
    occurredAt: toRequiredDate(row.occurred_at, "diagnostic_events.occurred_at"),
    acknowledgedAt: toDate(row.acknowledged_at),
    resolvedAt: toDate(row.resolved_at),
  };
}

type RawDiagnosticEventRow = Readonly<{
  id: unknown;
  event_type: unknown;
  severity: unknown;
  status: unknown;
  error_type: unknown;
  occurred_at: unknown;
  acknowledged_at: unknown;
  resolved_at: unknown;
}>;

function toAuditRecord(row: RawAuditRow): AdminAuditRecord {
  return {
    id: String(row.id),
    actorUserId: String(row.actor_user_id),
    action: row.action as AdminAuditAction,
    targetKind: row.target_kind as AdminAuditTargetKind,
    targetId: String(row.target_id),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    requestId: row.request_id === null || row.request_id === undefined
      ? null
      : String(row.request_id),
    beforeState: (row.before_state as Record<string, unknown> | null) ?? null,
    afterState: (row.after_state as Record<string, unknown> | null) ?? null,
    createdAt: toRequiredDate(row.created_at, "admin_audit_log.created_at"),
  };
}

type RawAuditRow = Readonly<{
  id: unknown;
  actor_user_id: unknown;
  action: unknown;
  target_kind: unknown;
  target_id: unknown;
  reason: unknown;
  request_id: unknown;
  before_state: unknown;
  after_state: unknown;
  created_at: unknown;
}>;

function toUserRecord(row: RawUserRow): AdminUserRecord {
  return {
    id: String(row.id),
    publicUid: String(row.public_uid),
    displayName:
      row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name),
    role: row.role as AccountRole,
    status: row.account_status as AccountStatus,
    createdAt: toRequiredDate(row.created_at, "profiles.created_at"),
    deletionRequestedAt: toDate(row.deletion_requested_at),
  };
}

type RawUserRow = Readonly<{
  id: unknown;
  public_uid: unknown;
  display_name: unknown;
  role: unknown;
  account_status: unknown;
  created_at: unknown;
  deletion_requested_at: unknown;
}>;

function uuidList(ids: readonly string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

function maxDate(values: readonly (Date | null)[]): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (value && (result === null || value.getTime() > result.getTime())) {
      result = value;
    }
  }
  return result;
}

const PUBLISHED_CONTENT_SQL = sql`
  (select count(*)::int
     from (
       select distinct on (av.article_id) av.id
       from article_versions av
       where av.status = 'published'
       order by av.article_id, av.version desc
     ) latest_articles
     where not exists (
       select 1 from user_generated_articles uga
       where uga.article_version_id = latest_articles.id
     )) as articles,
  (select count(*)::int
     from media_versions mv
     join media_items mi on mi.id = mv.media_item_id
     where mi.current_version = mv.version
       and mv.status = 'published'
       and mv.copyright_status = 'cleared'
       and mi.kind = 'video') as videos,
  (select count(*)::int
     from media_versions mv
     join media_items mi on mi.id = mv.media_item_id
     where mi.current_version = mv.version
       and mv.status = 'published'
       and mv.copyright_status = 'cleared'
       and mi.kind = 'podcast') as podcasts
`;

export function createDrizzleAdminReadRepository<TResult extends PgQueryResultHKT>(
  database: AdminDatabase<TResult>,
): AdminReadRepository {
  async function executeRows<Row>(query: SQL): Promise<readonly Row[]> {
    const result: unknown = await database.execute(query);
    return unwrapRows<Row>(result);
  }

  return {
    async listUsers(input: AdminUsersListInput): Promise<AdminUsersPageRecord> {
      const conditions: SQL[] = [];
      if (input.q) {
        const pattern = buildLikeContainsPattern(input.q);
        conditions.push(
          sql`(p.public_uid ilike ${pattern} escape '\\'
               or coalesce(p.display_name, '') ilike ${pattern} escape '\\')`,
        );
      }
      if (input.status) conditions.push(sql`p.account_status = ${input.status}`);
      if (input.role) conditions.push(sql`p.role = ${input.role}`);
      if (input.cursor) {
        const key = sql.raw(cursorKey("p.created_at"));
        conditions.push(
          sql`(${key} < ${input.cursor.createdAt}
               or (${key} = ${input.cursor.createdAt} and p.id < ${input.cursor.id}::uuid))`,
        );
      }
      const where = conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`;
      const rows = await executeRows<RawUserRow & { cursor_key: string }>(sql`
        select p.id, p.public_uid, p.display_name, p.role, p.account_status,
               p.created_at, p.deletion_requested_at,
               ${sql.raw(cursorKey("p.created_at"))} as cursor_key
        from profiles p
        where ${where}
        order by p.created_at desc, p.id desc
        limit ${input.limit + 1}
      `);
      const hasMore = rows.length > input.limit;
      const pageRows = rows.slice(0, input.limit);
      const last = pageRows.at(-1);
      return {
        users: pageRows.map(toUserRecord),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeAdminCursor({
                createdAt: String(last.cursor_key),
                id: String(last.id),
              })
            : null,
      };
    },

    async loadUserAggregates(
      userIds: readonly string[],
    ): Promise<ReadonlyMap<string, AdminUserAggregates>> {
      const result = new Map<string, AdminUserAggregates>();
      if (userIds.length === 0) return result;
      const aggregate: {
        lastActiveAt: Date | null;
        practiceSessions: number;
        practiceAttempts: number;
        evidenceEvents: number;
        conversationMessages: number;
        readingItems: number;
        mediaItems: number;
        lastPracticeAt: Date | null;
        lastEvidenceAt: Date | null;
        lastMessageAt: Date | null;
        lastActivityEventAt: Date | null;
        lastMediaAt: Date | null;
        lastReadingAt: Date | null;
      } = {
        lastActiveAt: null,
        practiceSessions: 0,
        practiceAttempts: 0,
        evidenceEvents: 0,
        conversationMessages: 0,
        readingItems: 0,
        mediaItems: 0,
        lastPracticeAt: null,
        lastEvidenceAt: null,
        lastMessageAt: null,
        lastActivityEventAt: null,
        lastMediaAt: null,
        lastReadingAt: null,
      };
      const placeholders = sql.join(
        userIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const [practiceRows, attemptRows, evidenceRows, messageRows, activityRows, mediaRows, readingRows] =
        await Promise.all([
          executeRows<{ user_id: string; n: unknown; last_at: unknown }>(sql`
            select user_id, count(*)::int as n, max(started_at) as last_at
            from practice_sessions
            where user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; n: unknown }>(sql`
            select user_id, count(*)::int as n
            from practice_attempts
            where user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; n: unknown; last_at: unknown }>(sql`
            select user_id, count(*)::int as n, max(occurred_at) as last_at
            from evidence_events
            where user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; n: unknown; last_at: unknown }>(sql`
            select user_id, count(*)::int as n, max(created_at) as last_at
            from messages
            where role = 'user' and user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; last_at: unknown }>(sql`
            select user_id, max(occurred_at) as last_at
            from practice_session_activity_events
            where user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; n: unknown; last_at: unknown }>(sql`
            select user_id, count(*)::int as n, max(last_opened_at) as last_at
            from user_media_progress
            where user_id in (${placeholders})
            group by user_id
          `),
          executeRows<{ user_id: string; n: unknown; last_at: unknown }>(sql`
            select user_id, count(*)::int as n, max(last_opened_at) as last_at
            from user_reading_progress
            where user_id in (${placeholders})
            group by user_id
          `),
        ]);

      const byId = new Map<string, typeof aggregate>();
      for (const id of userIds) {
        const entry = { ...aggregate };
        byId.set(id, entry);
        result.set(id, {
          lastActiveAt: null,
          practiceSessions: 0,
          practiceAttempts: 0,
          evidenceEvents: 0,
          conversationMessages: 0,
          readingItems: 0,
          mediaItems: 0,
        });
      }
      const entryFor = (id: string) => {
        const entry = byId.get(id);
        return entry ?? null;
      };
      for (const row of practiceRows) {
        const entry = entryFor(String(row.user_id));
        if (!entry) continue;
        entry.practiceSessions = asCount(row.n);
        entry.lastPracticeAt = toDate(row.last_at);
      }
      for (const row of attemptRows) {
        const entry = entryFor(String(row.user_id));
        if (entry) entry.practiceAttempts = asCount(row.n);
      }
      for (const row of evidenceRows) {
        const entry = entryFor(String(row.user_id));
        if (!entry) continue;
        entry.evidenceEvents = asCount(row.n);
        entry.lastEvidenceAt = toDate(row.last_at);
      }
      for (const row of messageRows) {
        const entry = entryFor(String(row.user_id));
        if (!entry) continue;
        entry.conversationMessages = asCount(row.n);
        entry.lastMessageAt = toDate(row.last_at);
      }
      for (const row of activityRows) {
        const entry = entryFor(String(row.user_id));
        if (entry) entry.lastActivityEventAt = toDate(row.last_at);
      }
      for (const row of mediaRows) {
        const entry = entryFor(String(row.user_id));
        if (!entry) continue;
        entry.mediaItems = asCount(row.n);
        entry.lastMediaAt = toDate(row.last_at);
      }
      for (const row of readingRows) {
        const entry = entryFor(String(row.user_id));
        if (!entry) continue;
        entry.readingItems = asCount(row.n);
        entry.lastReadingAt = toDate(row.last_at);
      }
      for (const [id, entry] of byId) {
        result.set(id, {
          lastActiveAt: maxDate([
            entry.lastPracticeAt,
            entry.lastEvidenceAt,
            entry.lastMessageAt,
            entry.lastActivityEventAt,
            entry.lastMediaAt,
            entry.lastReadingAt,
          ]),
          practiceSessions: entry.practiceSessions,
          practiceAttempts: entry.practiceAttempts,
          evidenceEvents: entry.evidenceEvents,
          conversationMessages: entry.conversationMessages,
          readingItems: entry.readingItems,
          mediaItems: entry.mediaItems,
        });
      }
      return result;
    },

    async findUserByPublicUid(publicUid: string): Promise<AdminUserRecord | null> {
      const rows = await executeRows<RawUserRow>(sql`
        select id, public_uid, display_name, role, account_status, created_at,
               deletion_requested_at
        from profiles
        where public_uid = ${publicUid}
        limit 1
      `);
      const row = rows[0];
      return row ? toUserRecord(row) : null;
    },

    async findUserInvitationSource(
      userId: string,
    ): Promise<AdminInvitationSourceRecord | null> {
      const rows = await executeRows<{
        id: unknown;
        email: unknown;
        role: unknown;
        status: unknown;
        created_at: unknown;
        accepted_at: unknown;
      }>(sql`
        select id, email, role, status, created_at, accepted_at
        from account_invitations
        where accepted_user_id = ${userId}::uuid
        order by accepted_at desc nulls last
        limit 1
      `);
      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        email: String(row.email),
        role: row.role as AccountRole,
        status: String(row.status),
        createdAt: toRequiredDate(row.created_at, "account_invitations.created_at"),
        acceptedAt: toDate(row.accepted_at),
      };
    },

    async listUserAuditEntries(
      input: AdminUserAuditInput,
    ): Promise<readonly AdminAuditRecord[]> {
      const rows = await executeRows<RawAuditRow>(sql`
        select id, actor_user_id, action, target_kind, target_id, reason,
               request_id, before_state, after_state, created_at
        from admin_audit_log
        where target_kind = 'user'
          and (target_id = ${input.publicUid} or target_id = ${input.userId})
        order by created_at desc, id desc
        limit ${input.limit}
      `);
      return rows.map(toAuditRecord);
    },

    async readOverview(input): Promise<AdminOverviewRecord> {
      const from = input.from.toISOString();
      const to = input.to.toISOString();
      const staleBefore = new Date(
        input.now.getTime() - ACQUISITION_RUN_STALE_AFTER_MS,
      ).toISOString();

      const [userRows, activeRows, contentRows, candidateRows, aiTotalsRows, aiTypeRows, acquisitionRows, diagnosticRows] =
        await Promise.all([
          executeRows<{
            total: unknown;
            new_in_window: unknown;
            suspended: unknown;
            owners: unknown;
          }>(sql`
            select
              (select count(*)::int from profiles) as total,
              (select count(*)::int from profiles
                 where created_at >= ${from}::timestamptz
                   and created_at <= ${to}::timestamptz) as new_in_window,
              (select count(*)::int from profiles where account_status = 'suspended') as suspended,
              (select count(*)::int from profiles where role = 'owner') as owners
          `),
          executeRows<{ active_in_window: unknown }>(sql`
            select count(distinct activity.user_id)::int as active_in_window
            from (
              select user_id from messages
                where role = 'user'
                  and created_at >= ${from}::timestamptz and created_at <= ${to}::timestamptz
              union all
              select user_id from practice_sessions
                where started_at >= ${from}::timestamptz and started_at <= ${to}::timestamptz
              union all
              select user_id from evidence_events
                where occurred_at >= ${from}::timestamptz and occurred_at <= ${to}::timestamptz
              union all
              select user_id from practice_session_activity_events
                where occurred_at >= ${from}::timestamptz and occurred_at <= ${to}::timestamptz
              union all
              select user_id from user_media_progress
                where last_opened_at >= ${from}::timestamptz and last_opened_at <= ${to}::timestamptz
              union all
              select user_id from user_reading_progress
                where last_opened_at >= ${from}::timestamptz and last_opened_at <= ${to}::timestamptz
            ) activity
          `),
          executeRows<{
            articles: unknown;
            videos: unknown;
            podcasts: unknown;
          }>(sql`select ${PUBLISHED_CONTENT_SQL}`),
          executeRows<{ status: string; n: unknown }>(sql`
            select status, count(*)::int as n
            from content_candidates
            group by status
          `),
          executeRows<RawProviderTotalsRow>(sql`
            select
              count(*)::int as calls,
              (count(*) filter (where status = 'succeeded'))::int as succeeded,
              (count(*) filter (where status = 'failed'))::int as failed,
              (count(*) filter (where status = 'cancelled'))::int as cancelled,
              (count(*) filter (where status = 'started'))::int as started,
              percentile_cont(0.5) within group (order by latency_ms)
                filter (where status = 'succeeded') as p50_latency_ms,
              percentile_cont(0.95) within group (order by latency_ms)
                filter (where status = 'succeeded') as p95_latency_ms,
              coalesce(sum(estimated_cost_micros), 0)::bigint as estimated_cost_micros,
              (count(*) filter (where estimated_cost_micros is not null))::int as cost_known_calls
            from provider_calls
            where started_at >= ${from}::timestamptz and started_at <= ${to}::timestamptz
          `),
          executeRows<RawProviderTotalsRow & { provider_type: string }>(sql`
            select
              provider_type,
              count(*)::int as calls,
              (count(*) filter (where status = 'succeeded'))::int as succeeded,
              (count(*) filter (where status = 'failed'))::int as failed,
              (count(*) filter (where status = 'cancelled'))::int as cancelled,
              (count(*) filter (where status = 'started'))::int as started,
              percentile_cont(0.5) within group (order by latency_ms)
                filter (where status = 'succeeded') as p50_latency_ms,
              percentile_cont(0.95) within group (order by latency_ms)
                filter (where status = 'succeeded') as p95_latency_ms,
              coalesce(sum(estimated_cost_micros), 0)::bigint as estimated_cost_micros,
              (count(*) filter (where estimated_cost_micros is not null))::int as cost_known_calls
            from provider_calls
            where started_at >= ${from}::timestamptz and started_at <= ${to}::timestamptz
            group by provider_type
            order by calls desc, provider_type asc
            limit 50
          `),
          executeRows<{
            runs_in_window: unknown;
            failed_runs: unknown;
            running_stale: unknown;
            last_run_at: unknown;
          }>(sql`
            select
              (select count(*)::int from acquisition_runs
                 where started_at >= ${from}::timestamptz
                   and started_at <= ${to}::timestamptz) as runs_in_window,
              (select count(*)::int from acquisition_runs
                 where status = 'failed'
                   and started_at >= ${from}::timestamptz
                   and started_at <= ${to}::timestamptz) as failed_runs,
              (select count(*)::int from acquisition_runs
                 where status = 'running'
                   and started_at < ${staleBefore}::timestamptz) as running_stale,
              (select max(started_at) from acquisition_runs) as last_run_at
          `),
          executeRows<{
            open: unknown;
            acknowledged: unknown;
            alerts_in_window: unknown;
            storage_cleanup_failed: unknown;
          }>(sql`
            select
              (select count(*)::int from diagnostic_events where status = 'open') as open,
              (select count(*)::int from diagnostic_events
                 where status = 'acknowledged') as acknowledged,
              (select count(*)::int from diagnostic_events
                 where severity = 'alert'
                   and occurred_at >= ${from}::timestamptz
                   and occurred_at <= ${to}::timestamptz) as alerts_in_window,
              (select count(*)::int from privacy_cleanup_tasks
                 where status = 'failed') as storage_cleanup_failed
          `),
        ]);

      const users = userRows[0];
      const content = contentRows[0];
      const aiTotals = providerCostUnknown(
        toProviderTotals(aiTotalsRows[0] ?? emptyProviderTotalsRow()),
      );
      const acquisition = acquisitionRows[0];
      const diagnostics = diagnosticRows[0];
      return {
        users: {
          total: asCount(users?.total),
          newInWindow: asCount(users?.new_in_window),
          activeInWindow: asCount(activeRows[0]?.active_in_window),
          suspended: asCount(users?.suspended),
          owners: asCount(users?.owners),
        },
        content: {
          published: {
            articles: asCount(content?.articles),
            videos: asCount(content?.videos),
            podcasts: asCount(content?.podcasts),
          },
          candidates: toCandidateCounts(candidateRows),
          reviewBacklog: toCandidateCounts(candidateRows).review_ready,
        },
        ai: {
          totals: aiTotals,
          byProviderType: aiTypeRows.map((row) =>
            providerCostUnknown({
              ...toProviderTotals(row),
              providerType: String(row.provider_type),
            }),
          ),
        },
        acquisition: {
          runsInWindow: asCount(acquisition?.runs_in_window),
          failedRuns: asCount(acquisition?.failed_runs),
          runningStale: asCount(acquisition?.running_stale),
          lastRunAt: toDate(acquisition?.last_run_at),
        },
        diagnostics: {
          open: asCount(diagnostics?.open),
          acknowledged: asCount(diagnostics?.acknowledged),
          alertsInWindow: asCount(diagnostics?.alerts_in_window),
          storageCleanupFailed: asCount(diagnostics?.storage_cleanup_failed),
        },
      };
    },

    async readAiUsage(input: AdminAiUsageQueryRecord): Promise<AdminAiUsageRecord> {
      const from = input.from.toISOString();
      const to = input.to.toISOString();
      const conditions: SQL[] = [
        sql`started_at >= ${from}::timestamptz`,
        sql`started_at <= ${to}::timestamptz`,
      ];
      if (input.providerType) {
        conditions.push(sql`provider_type = ${input.providerType}`);
      }
      if (input.provider) {
        conditions.push(sql`provider = ${input.provider}`);
      }
      const where = sql.join(conditions, sql` and `);
      const aggregateSelect = sql.raw(`
        count(*)::int as calls,
        (count(*) filter (where status = 'succeeded'))::int as succeeded,
        (count(*) filter (where status = 'failed'))::int as failed,
        (count(*) filter (where status = 'cancelled'))::int as cancelled,
        (count(*) filter (where status = 'started'))::int as started,
        percentile_cont(0.5) within group (order by latency_ms)
          filter (where status = 'succeeded') as p50_latency_ms,
        percentile_cont(0.95) within group (order by latency_ms)
          filter (where status = 'succeeded') as p95_latency_ms,
        coalesce(sum(estimated_cost_micros), 0)::bigint as estimated_cost_micros,
        (count(*) filter (where estimated_cost_micros is not null))::int as cost_known_calls
      `);

      const [totalsRows, typeRows, providerRows, dayRows, errorRows, safetyRows] =
        await Promise.all([
          executeRows<RawProviderTotalsRow>(sql`
            select ${aggregateSelect}
            from provider_calls
            where ${where}
          `),
          executeRows<RawProviderTotalsRow & { provider_type: string }>(sql`
            select provider_type, ${aggregateSelect}
            from provider_calls
            where ${where}
            group by provider_type
            order by calls desc, provider_type asc
            limit 50
          `),
          executeRows<
            RawProviderTotalsRow & { provider: string; provider_type: string }
          >(sql`
            select provider, provider_type, ${aggregateSelect}
            from provider_calls
            where ${where}
            group by provider, provider_type
            order by calls desc, provider asc, provider_type asc
            limit 100
          `),
          executeRows<{
            day: string;
            calls: unknown;
            failed: unknown;
            estimated_cost_micros: unknown;
            cost_known_calls: unknown;
          }>(sql`
            select
              to_char(date_trunc('day', started_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
              count(*)::int as calls,
              (count(*) filter (where status = 'failed'))::int as failed,
              coalesce(sum(estimated_cost_micros), 0)::bigint as estimated_cost_micros,
              (count(*) filter (where estimated_cost_micros is not null))::int as cost_known_calls
            from provider_calls
            where ${where}
            group by 1
            order by 1 asc
            limit 92
          `),
          executeRows<{ error_type: string; n: unknown }>(sql`
            select error_type, count(*)::int as n
            from provider_calls
            where ${where} and status = 'failed' and error_type is not null
            group by error_type
            order by n desc, error_type asc
            limit 5
          `),
          executeRows<{
            conversation_blocked_generations: unknown;
            proactive_blocked_candidates: unknown;
          }>(sql`
            select
              (select count(distinct generation_id)::int
                 from provider_calls
                 where provider_type = 'conversation'
                   and error_type = ${SAFETY_GATE_ERROR_TYPE}
                   and status = 'failed'
                   and generation_id is not null
                   and started_at >= ${from}::timestamptz
                   and started_at <= ${to}::timestamptz) as conversation_blocked_generations,
              (select count(*)::int
                 from proactive_message_candidates
                 where last_error_code = ${SAFETY_GATE_ERROR_TYPE}
                   and created_at >= ${from}::timestamptz
                   and created_at <= ${to}::timestamptz) as proactive_blocked_candidates
          `),
        ]);

      const safety = safetyRows[0];
      return {
        totals: providerCostUnknown(
          toProviderTotals(totalsRows[0] ?? emptyProviderTotalsRow()),
        ),
        byProviderType: typeRows.map((row) =>
          providerCostUnknown({
            ...toProviderTotals(row),
            providerType: String(row.provider_type),
          }),
        ),
        byProvider: providerRows.map(
          (row): AdminProviderTotals => ({
            ...providerCostUnknown(toProviderTotals(row)),
            provider: String(row.provider),
            providerType: String(row.provider_type),
          }),
        ),
        byDay: dayRows.map(
          (row): AdminAiDayTotals => ({
            date: String(row.day),
            calls: asCount(row.calls),
            failed: asCount(row.failed),
            estimatedCostMicros: asCount(row.estimated_cost_micros),
            costUnknownCalls: Math.max(
              0,
              asCount(row.calls) - asCount(row.cost_known_calls),
            ),
          }),
        ),
        topErrorTypes: errorRows.map(
          (row): AdminAiErrorTotals => ({
            errorType: String(row.error_type),
            count: asCount(row.n),
          }),
        ),
        safetyGate: {
          conversationBlockedGenerations: asCount(
            safety?.conversation_blocked_generations,
          ),
          proactiveBlockedCandidates: asCount(
            safety?.proactive_blocked_candidates,
          ),
        } satisfies AdminSafetyGateRecord,
      };
    },

    async readContentHealth(input): Promise<AdminContentHealthRecord> {
      const from = input.from.toISOString();
      const to = input.to.toISOString();
      const staleBefore = new Date(
        input.now.getTime() - ACQUISITION_RUN_STALE_AFTER_MS,
      ).toISOString();
      const now = input.now.toISOString();

      const [runsRows, staleRows, lastRunRows, candidateRows, publishedRows, mediaRows, backfillRows, corpusRows] =
        await Promise.all([
          executeRows<{
            runs_in_window: unknown;
            succeeded_runs: unknown;
            failed_runs: unknown;
            cancelled_runs: unknown;
            running_runs: unknown;
            inserted_count: unknown;
            duplicate_count: unknown;
          }>(sql`
            select
              count(*)::int as runs_in_window,
              (count(*) filter (where status = 'succeeded'))::int as succeeded_runs,
              (count(*) filter (where status = 'failed'))::int as failed_runs,
              (count(*) filter (where status = 'cancelled'))::int as cancelled_runs,
              (count(*) filter (where status = 'running'))::int as running_runs,
              coalesce(sum(inserted_count), 0)::int as inserted_count,
              coalesce(sum(duplicate_count), 0)::int as duplicate_count
            from acquisition_runs
            where started_at >= ${from}::timestamptz
              and started_at <= ${to}::timestamptz
          `),
          executeRows<{ n: unknown }>(sql`
            select count(*)::int as n
            from acquisition_runs
            where status = 'running' and started_at < ${staleBefore}::timestamptz
          `),
          executeRows<{ last_run_at: unknown }>(sql`
            select max(started_at) as last_run_at from acquisition_runs
          `),
          executeRows<{ status: string; n: unknown }>(sql`
            select status, count(*)::int as n
            from content_candidates
            group by status
          `),
          executeRows<{
            articles: unknown;
            videos: unknown;
            podcasts: unknown;
          }>(sql`select ${PUBLISHED_CONTENT_SQL}`),
          executeRows<RawMediaHealthRow>(sql`
            with current_published as (
              select mv.id, mv.copyright_status, mv.artwork_url
              from media_versions mv
              join media_items mi on mi.id = mv.media_item_id
              where mi.current_version = mv.version and mv.status = 'published'
            )
            select
              (select count(*)::int from current_published) as published_versions,
              (select count(*)::int from current_published cp
                 where not exists (
                   select 1 from media_segments s
                   where s.media_version_id = cp.id and s.words is not null
                 )) as missing_word_timeline,
              (select count(*)::int from current_published cp
                 where not exists (
                   select 1 from media_segments s
                   where s.media_version_id = cp.id
                     and s.translation is not null
                     and btrim(s.translation) <> ''
                 )) as missing_chinese_translation,
              (select count(*)::int from current_published cp
                 where not exists (
                   select 1 from media_assets a
                   where a.media_version_id = cp.id and a.availability = 'available'
                 )) as missing_playable_asset,
              (select count(*)::int from current_published cp
                 where exists (
                   select 1 from media_assets a
                   where a.media_version_id = cp.id
                     and a.availability = 'available'
                     and a.playback_expires_at is not null
                     and a.playback_expires_at < ${now}::timestamptz
                 )) as expired_playback_asset,
              (select count(*)::int from current_published cp
                 where cp.artwork_url is null) as missing_artwork,
              (select count(*)::int from current_published cp
                 where cp.copyright_status <> 'cleared') as copyright_not_cleared
          `),
          executeRows<{ n: unknown }>(sql`
            select count(*)::int as n
            from media_transcript_backfills
            where status in ('draft', 'approved')
          `),
          executeRows<{
            occurrences: unknown;
            occurrences_in_window: unknown;
            last_indexed_at: unknown;
          }>(sql`
            select
              count(*)::int as occurrences,
              (count(*) filter (
                where created_at >= ${from}::timestamptz
                  and created_at <= ${to}::timestamptz
              ))::int as occurrences_in_window,
              max(created_at) as last_indexed_at
            from corpus_occurrences
          `),
        ]);

      const runs = runsRows[0];
      const media = mediaRows[0] ?? emptyMediaHealthRow();
      const corpus = corpusRows[0];
      const candidates = toCandidateCounts(candidateRows);
      return {
        acquisition: {
          runsInWindow: asCount(runs?.runs_in_window),
          succeededRuns: asCount(runs?.succeeded_runs),
          failedRuns: asCount(runs?.failed_runs),
          cancelledRuns: asCount(runs?.cancelled_runs),
          runningRuns: asCount(runs?.running_runs),
          runningStale: asCount(staleRows[0]?.n),
          lastRunAt: toDate(lastRunRows[0]?.last_run_at),
          insertedCountInWindow: asCount(runs?.inserted_count),
          duplicateCountInWindow: asCount(runs?.duplicate_count),
        } satisfies AdminAcquisitionHealthRecord,
        candidates,
        published: {
          articles: asCount(publishedRows[0]?.articles),
          videos: asCount(publishedRows[0]?.videos),
          podcasts: asCount(publishedRows[0]?.podcasts),
        },
        media: {
          publishedVersions: asCount(media.published_versions),
          missingWordTimeline: asCount(media.missing_word_timeline),
          missingChineseTranslation: asCount(media.missing_chinese_translation),
          missingPlayableAsset: asCount(media.missing_playable_asset),
          expiredPlaybackAsset: asCount(media.expired_playback_asset),
          missingArtwork: asCount(media.missing_artwork),
          copyrightNotCleared: asCount(media.copyright_not_cleared),
          transcriptBackfillPending: asCount(backfillRows[0]?.n),
        } satisfies AdminMediaHealthRecord,
        corpus: {
          occurrences: asCount(corpus?.occurrences),
          occurrencesInWindow: asCount(corpus?.occurrences_in_window),
          lastIndexedAt: toDate(corpus?.last_indexed_at),
        } satisfies AdminCorpusFreshnessRecord,
      };
    },

    async listDiagnostics(
      input: AdminDiagnosticsListInput,
    ): Promise<AdminDiagnosticsPageRecord> {
      const conditions: SQL[] = [];
      if (input.status) conditions.push(sql`status = ${input.status}`);
      if (input.severity) conditions.push(sql`severity = ${input.severity}`);
      if (input.eventType) conditions.push(sql`event_type = ${input.eventType}`);
      if (input.since) {
        conditions.push(
          sql`occurred_at >= ${input.since.toISOString()}::timestamptz`,
        );
      }
      if (input.cursor) {
        const key = sql.raw(cursorKey("created_at"));
        conditions.push(
          sql`(${key} < ${input.cursor.createdAt}
               or (${key} = ${input.cursor.createdAt} and id < ${input.cursor.id}::uuid))`,
        );
      }
      const where = conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`;
      const [eventRows, aggregateRows, byTypeRows, cleanupRows] = await Promise.all([
        executeRows<RawDiagnosticEventRow & { cursor_key: string }>(sql`
          select id, event_type, severity, status, error_type, occurred_at,
                 acknowledged_at, resolved_at,
                 ${sql.raw(cursorKey("created_at"))} as cursor_key
          from diagnostic_events
          where ${where}
          order by created_at desc, id desc
          limit ${input.limit + 1}
        `),
        executeRows<{
          open: unknown;
          acknowledged: unknown;
          resolved: unknown;
        }>(sql`
          select
            (count(*) filter (where status = 'open'))::int as open,
            (count(*) filter (where status = 'acknowledged'))::int as acknowledged,
            (count(*) filter (where status = 'resolved'))::int as resolved
          from diagnostic_events
        `),
        executeRows<{
          event_type: string;
          open: unknown;
          total: unknown;
        }>(sql`
          select
            event_type,
            (count(*) filter (where status = 'open'))::int as open,
            count(*)::int as total
          from diagnostic_events
          group by event_type
          order by total desc, event_type asc
        `),
        executeRows<{ n: unknown }>(sql`
          select count(*)::int as n
          from privacy_cleanup_tasks
          where status = 'failed'
        `),
      ]);
      const hasMore = eventRows.length > input.limit;
      const pageRows = eventRows.slice(0, input.limit);
      const last = pageRows.at(-1);
      const aggregateRow = aggregateRows[0];
      const aggregate: AdminDiagnosticsAggregateRecord = {
        open: asCount(aggregateRow?.open),
        acknowledged: asCount(aggregateRow?.acknowledged),
        resolved: asCount(aggregateRow?.resolved),
        byEventType: byTypeRows
          .filter((row) =>
            (["conversation.stream_failed", "evidence.duplicate", "memory.conflict", "privacy.storage_cleanup_failed"] as readonly string[]).includes(row.event_type),
          )
          .map((row) => ({
            eventType: row.event_type as DiagnosticEventType,
            open: asCount(row.open),
            total: asCount(row.total),
          })),
        storageCleanupFailed: asCount(cleanupRows[0]?.n),
      };
      return {
        events: pageRows.map(toDiagnosticEvent),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeAdminCursor({
                createdAt: String(last.cursor_key),
                id: String(last.id),
              })
            : null,
        aggregate,
      };
    },

    async findDiagnosticEvent(eventId: string): Promise<AdminDiagnosticEventRecord | null> {
      const rows = await executeRows<RawDiagnosticEventRow>(sql`
        select id, event_type, severity, status, error_type, occurred_at,
               acknowledged_at, resolved_at
        from diagnostic_events
        where id = ${eventId}::uuid
        limit 1
      `);
      const row = rows[0];
      return row ? toDiagnosticEvent(row) : null;
    },

    async transitionDiagnosticEvent(
      input: AdminDiagnosticTransitionInput,
    ): Promise<AdminDiagnosticEventRecord | null> {
      const rows = await executeRows<RawDiagnosticEventRow>(sql`
        update diagnostic_events
        set status = ${input.status},
            acknowledged_at = case
              when ${input.status} = 'acknowledged' then ${input.now.toISOString()}::timestamptz
              else acknowledged_at
            end,
            resolved_at = case
              when ${input.status} = 'resolved' then ${input.now.toISOString()}::timestamptz
              else resolved_at
            end,
            updated_at = ${input.now.toISOString()}::timestamptz
        where id = ${input.eventId}::uuid
          and (
            (status = 'open' and ${input.status} = 'acknowledged')
            or (status = 'acknowledged' and ${input.status} = 'resolved')
          )
        returning id, event_type, severity, status, error_type, occurred_at,
                  acknowledged_at, resolved_at
      `);
      const row = rows[0];
      return row ? toDiagnosticEvent(row) : null;
    },

    async listAuditEntries(
      input: AdminAuditListInput,
    ): Promise<AdminAuditEntriesPageRecord> {
      const conditions: SQL[] = [];
      if (input.action) conditions.push(sql`action = ${input.action}`);
      if (input.targetKind) conditions.push(sql`target_kind = ${input.targetKind}`);
      if (input.cursor) {
        const key = sql.raw(cursorKey("created_at"));
        conditions.push(
          sql`(${key} < ${input.cursor.createdAt}
               or (${key} = ${input.cursor.createdAt} and id < ${input.cursor.id}::uuid))`,
        );
      }
      const where = conditions.length > 0 ? sql.join(conditions, sql` and `) : sql`true`;
      const rows = await executeRows<RawAuditRow & { cursor_key: string }>(sql`
        select id, actor_user_id, action, target_kind, target_id, reason,
               request_id, before_state, after_state, created_at,
               ${sql.raw(cursorKey("created_at"))} as cursor_key
        from admin_audit_log
        where ${where}
        order by created_at desc, id desc
        limit ${input.limit + 1}
      `);
      const hasMore = rows.length > input.limit;
      const pageRows = rows.slice(0, input.limit);
      const last = pageRows.at(-1);
      return {
        entries: pageRows.map(toAuditRecord),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeAdminCursor({
                createdAt: String(last.cursor_key),
                id: String(last.id),
              })
            : null,
      };
    },

    async resolveAuditTargetLabels(
      entries: readonly AdminAuditRecord[],
    ): Promise<ReadonlyMap<string, string>> {
      const labels = new Map<string, string>();
      if (entries.length === 0) return labels;
      const userIds = new Set<string>();
      const userPublicUids = new Set<string>();
      const invitationIds = new Set<string>();
      const diagnosticIds = new Set<string>();
      const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          value,
        );
      for (const entry of entries) {
        if (entry.targetKind === "user") {
          if (isUuid(entry.targetId)) userIds.add(entry.targetId);
          else userPublicUids.add(entry.targetId);
        } else if (entry.targetKind === "invitation" && isUuid(entry.targetId)) {
          invitationIds.add(entry.targetId);
        } else if (entry.targetKind === "diagnostic_event" && isUuid(entry.targetId)) {
          diagnosticIds.add(entry.targetId);
        }
      }

      const [internalUserRows, publicUidRows, invitationRows, diagnosticRows] =
        await Promise.all([
          userIds.size > 0
            ? executeRows<{ id: string; public_uid: string }>(sql`
                select id::text as id, public_uid
                from profiles
                where id in (${uuidList([...userIds])})
              `)
            : Promise.resolve([]),
          userPublicUids.size > 0
            ? executeRows<{ public_uid: string }>(sql`
                select public_uid
                from profiles
                where public_uid in (${sql.join(
                  [...userPublicUids].map((uid) => sql`${uid}`),
                  sql`, `,
                )})
              `)
            : Promise.resolve([]),
          invitationIds.size > 0
            ? executeRows<{ id: string; email: string }>(sql`
                select id::text as id, email
                from account_invitations
                where id in (${uuidList([...invitationIds])})
              `)
            : Promise.resolve([]),
          diagnosticIds.size > 0
            ? executeRows<{ id: string; event_type: string }>(sql`
                select id::text as id, event_type
                from diagnostic_events
                where id in (${uuidList([...diagnosticIds])})
              `)
            : Promise.resolve([]),
        ]);

      const userLabelById = new Map(
        internalUserRows.map((row) => [row.id, row.public_uid] as const),
      );
      const publicUidSet = new Set(publicUidRows.map((row) => row.public_uid));
      const invitationLabelById = new Map(
        invitationRows.map((row) => [row.id, maskEmail(row.email)] as const),
      );
      const diagnosticLabelById = new Map(
        diagnosticRows.map((row) => [row.id, row.event_type] as const),
      );
      for (const entry of entries) {
        if (entry.targetKind === "user") {
          const label =
            userLabelById.get(entry.targetId) ??
            (publicUidSet.has(entry.targetId) ? entry.targetId : null);
          if (label) labels.set(`user:${entry.targetId}`, label);
        } else if (entry.targetKind === "invitation") {
          const label = invitationLabelById.get(entry.targetId);
          if (label) labels.set(`invitation:${entry.targetId}`, label);
        } else {
          const label = diagnosticLabelById.get(entry.targetId);
          if (label) labels.set(`diagnostic_event:${entry.targetId}`, label);
        }
      }
      return labels;
    },
  };
}

type RawMediaHealthRow = Readonly<{
  published_versions: unknown;
  missing_word_timeline: unknown;
  missing_chinese_translation: unknown;
  missing_playable_asset: unknown;
  expired_playback_asset: unknown;
  missing_artwork: unknown;
  copyright_not_cleared: unknown;
}>;

function emptyMediaHealthRow(): RawMediaHealthRow {
  return {
    published_versions: 0,
    missing_word_timeline: 0,
    missing_chinese_translation: 0,
    missing_playable_asset: 0,
    expired_playback_asset: 0,
    missing_artwork: 0,
    copyright_not_cleared: 0,
  };
}

function emptyProviderTotalsRow(): RawProviderTotalsRow {
  return {
    calls: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
    started: 0,
    p50_latency_ms: null,
    p95_latency_ms: null,
    estimated_cost_micros: 0,
    cost_known_calls: 0,
  };
}
