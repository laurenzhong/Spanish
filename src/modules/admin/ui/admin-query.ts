/**
 * Admin console URL/search state (ACCT-ADMIN-001 slice U1).
 *
 * The console reads every filter and cursor from the URL so a page is
 * bookmarkable and server-rendered. Parsing is deliberately lenient about
 * absent values and strict about present ones: an unknown filter value means
 * the link is stale, and the page shows an explicit "筛选条件无效" state with a
 * reset link instead of silently dropping the filter.
 *
 * This module is imported by both server pages and client panels, so it must
 * stay free of server-only imports (types are erased).
 */

import type { AdminWindow } from "../domain/admin-console";
import type {
  DiagnosticEventType,
  DiagnosticSeverity,
  DiagnosticStatus,
} from "../domain/admin-console";
import type { AdminAuditAction, AdminAuditTargetKind } from "../domain/admin-audit";
import { buildAdminHref } from "./format";

export type AdminSearchParams = Readonly<
  Record<string, string | string[] | undefined>
>;

export type AdminUserRoleFilter = "owner" | "member";
export type AdminUserStatusFilter = "active" | "suspended";
export type AdminInvitationStatusFilter =
  | "pending"
  | "redeeming"
  | "accepted"
  | "expired"
  | "revoked"
  | "failed";

export const ADMIN_DEFAULT_PAGE_LIMIT = 20;
export const ADMIN_MAX_PAGE_LIMIT = 100;
export const ADMIN_MAX_AI_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;

const ADMIN_WINDOWS: readonly AdminWindow[] = ["24h", "7d", "30d"];
const USER_ROLES: readonly AdminUserRoleFilter[] = ["owner", "member"];
const USER_STATUSES: readonly AdminUserStatusFilter[] = ["active", "suspended"];
const INVITATION_STATUSES: readonly AdminInvitationStatusFilter[] = [
  "pending",
  "redeeming",
  "accepted",
  "expired",
  "revoked",
  "failed",
];
const DIAGNOSTIC_STATUSES: readonly DiagnosticStatus[] = [
  "open",
  "acknowledged",
  "resolved",
];
const DIAGNOSTIC_SEVERITIES: readonly DiagnosticSeverity[] = ["warning", "alert"];
const DIAGNOSTIC_EVENT_TYPES: readonly DiagnosticEventType[] = [
  "conversation.stream_failed",
  "evidence.duplicate",
  "memory.conflict",
  "privacy.storage_cleanup_failed",
];
const AUDIT_ACTIONS: readonly AdminAuditAction[] = [
  "invitation.create",
  "invitation.revoke",
  "user.suspend",
  "user.activate",
  "user.delete",
  "user.sessions_revoke",
  "diagnostic.acknowledge",
  "diagnostic.resolve",
];
const AUDIT_TARGET_KINDS: readonly AdminAuditTargetKind[] = [
  "user",
  "invitation",
  "diagnostic_event",
];

export type AdminWindowFilterState = Readonly<{ window: AdminWindow }>;

export type AdminUsersFilterState = Readonly<{
  q: string | null;
  status: AdminUserStatusFilter | null;
  role: AdminUserRoleFilter | null;
  limit: number;
  cursor: string | null;
}>;

export type AdminInvitationsFilterState = Readonly<{
  status: AdminInvitationStatusFilter | null;
  limit: number;
  cursor: string | null;
}>;

export type AdminDiagnosticsFilterState = Readonly<{
  status: DiagnosticStatus | null;
  severity: DiagnosticSeverity | null;
  eventType: DiagnosticEventType | null;
  /** ISO instant used for the API `since` filter. */
  since: string | null;
  limit: number;
  cursor: string | null;
}>;

export type AdminAuditFilterState = Readonly<{
  action: AdminAuditAction | null;
  targetKind: AdminAuditTargetKind | null;
  limit: number;
  cursor: string | null;
}>;

export type AdminAiUsageFilterState = Readonly<{
  /** Named shortcut window (`24h`/`7d`/`30d`); null for a custom range. */
  range: AdminWindow | null;
  /** ISO instants after validation. */
  from: string | null;
  to: string | null;
  providerType: string | null;
  provider: string | null;
}>;

/** One raw search-param value; arrays are rejected as ambiguous. */
export function singleAdminParam(
  params: AdminSearchParams,
  key: string,
): string | undefined | null {
  const value = params[key];
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

export function parseAdminWindowSearch(params: AdminSearchParams): AdminWindow | null {
  const raw = singleAdminParam(params, "window");
  if (raw === undefined) return "7d";
  if (raw === null) return null;
  return isOneOf(ADMIN_WINDOWS, raw) ? raw : null;
}

export function parseAdminUsersSearch(
  params: AdminSearchParams,
): AdminUsersFilterState | null {
  const q = optionalTrimmedString(params, "q", 80);
  const status = optionalEnum(params, "status", USER_STATUSES);
  const role = optionalEnum(params, "role", USER_ROLES);
  const limit = parseLimit(params);
  const cursor = parseCursor(params);
  if (q === false || status === false || role === false || limit === null || cursor === false) {
    return null;
  }
  return { q, status, role, limit, cursor };
}

export function parseAdminInvitationsSearch(
  params: AdminSearchParams,
): AdminInvitationsFilterState | null {
  const status = optionalEnum(params, "status", INVITATION_STATUSES);
  const limit = parseLimit(params);
  const cursor = parseCursor(params);
  if (status === false || limit === null || cursor === false) return null;
  return { status, limit, cursor };
}

export function parseAdminDiagnosticsSearch(
  params: AdminSearchParams,
): AdminDiagnosticsFilterState | null {
  const status = optionalEnum(params, "status", DIAGNOSTIC_STATUSES);
  const severity = optionalEnum(params, "severity", DIAGNOSTIC_SEVERITIES);
  const eventType = optionalEnum(params, "eventType", DIAGNOSTIC_EVENT_TYPES);
  const limit = parseLimit(params);
  const cursor = parseCursor(params);
  const sinceRaw = singleAdminParam(params, "since");
  let since: string | null = null;
  if (sinceRaw === null) return null;
  if (sinceRaw !== undefined && sinceRaw !== "") {
    const parsed = new Date(sinceRaw);
    if (Number.isNaN(parsed.getTime())) return null;
    since = parsed.toISOString();
  }
  if (
    status === false ||
    severity === false ||
    eventType === false ||
    limit === null ||
    cursor === false
  ) {
    return null;
  }
  return { status, severity, eventType, since, limit, cursor };
}

export function parseAdminAuditSearch(
  params: AdminSearchParams,
): AdminAuditFilterState | null {
  const action = optionalEnum(params, "action", AUDIT_ACTIONS);
  const targetKind = optionalEnum(params, "targetKind", AUDIT_TARGET_KINDS);
  const limit = parseLimit(params);
  const cursor = parseCursor(params);
  if (action === false || targetKind === false || limit === null || cursor === false) {
    return null;
  }
  return { action, targetKind, limit, cursor };
}

export function parseAdminAiUsageSearch(
  params: AdminSearchParams,
): AdminAiUsageFilterState | null {
  const rangeRaw = singleAdminParam(params, "range");
  let range: AdminWindow | null = null;
  if (rangeRaw === null) return null;
  if (rangeRaw !== undefined && rangeRaw !== "") {
    if (!isOneOf(ADMIN_WINDOWS, rangeRaw)) return null;
    range = rangeRaw;
  }

  const fromRaw = singleAdminParam(params, "from");
  const toRaw = singleAdminParam(params, "to");
  if (fromRaw === null || toRaw === null) return null;
  let from: string | null = null;
  let to: string | null = null;
  const fromDate = fromRaw ? new Date(fromRaw) : null;
  const toDate = toRaw ? new Date(toRaw) : null;
  if (fromRaw) {
    if (!fromDate || Number.isNaN(fromDate.getTime())) return null;
    from = fromDate.toISOString();
  }
  if (toRaw) {
    if (!toDate || Number.isNaN(toDate.getTime())) return null;
    to = toDate.toISOString();
  }
  if (from && to) {
    const span = toDate!.getTime() - fromDate!.getTime();
    if (span < 0 || span > ADMIN_MAX_AI_RANGE_MS) return null;
  }

  const providerType = optionalTrimmedString(params, "providerType", 80);
  const provider = optionalTrimmedString(params, "provider", 120);
  if (providerType === false || provider === false) return null;

  return { range, from, to, providerType, provider };
}

export function buildAdminUsersHref(
  filters: AdminUsersFilterState,
  overrides: Partial<AdminUsersFilterState> = {},
): string {
  const merged = { ...filters, ...overrides };
  return buildAdminHref("/admin/users", {
    q: merged.q,
    status: merged.status,
    role: merged.role,
    limit: merged.limit,
    cursor: normalizeCursor(merged.cursor),
  });
}

export function buildAdminInvitationsHref(
  filters: AdminInvitationsFilterState,
  overrides: Partial<AdminInvitationsFilterState> = {},
): string {
  const merged = { ...filters, ...overrides };
  return buildAdminHref("/admin/invitations", {
    status: merged.status,
    limit: merged.limit,
    cursor: normalizeCursor(merged.cursor),
  });
}

export function buildAdminDiagnosticsHref(
  filters: AdminDiagnosticsFilterState,
  overrides: Partial<AdminDiagnosticsFilterState> = {},
): string {
  const merged = { ...filters, ...overrides };
  return buildAdminHref("/admin/diagnostics", {
    status: merged.status,
    severity: merged.severity,
    eventType: merged.eventType,
    since: merged.since,
    limit: merged.limit,
    cursor: normalizeCursor(merged.cursor),
  });
}

export function buildAdminAuditHref(
  filters: AdminAuditFilterState,
  overrides: Partial<AdminAuditFilterState> = {},
): string {
  const merged = { ...filters, ...overrides };
  return buildAdminHref("/admin/audit", {
    action: merged.action,
    targetKind: merged.targetKind,
    limit: merged.limit,
    cursor: normalizeCursor(merged.cursor),
  });
}

export function buildAdminAiUsageHref(
  filters: AdminAiUsageFilterState,
  overrides: Partial<AdminAiUsageFilterState> = {},
): string {
  const merged = { ...filters, ...overrides };
  return buildAdminHref("/admin/ai-usage", {
    range: merged.range,
    from: merged.from,
    to: merged.to,
    providerType: merged.providerType,
    provider: merged.provider,
  });
}

export function buildAdminWindowHref(window: AdminWindow): string {
  return buildAdminHref("/admin", { window });
}

/** User detail URLs always use the public UID, never the internal profile id. */
export function buildAdminUserDetailHref(publicUid: string): string {
  return `/admin/users/${encodeURIComponent(publicUid)}`;
}

export function buildAdminPageHref(
  pathname: string,
  window: AdminWindow,
): string {
  return buildAdminHref(pathname, { window });
}

function normalizeCursor(cursor: string | null | undefined): string | null {
  return cursor ? cursor : null;
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** `undefined` when absent, the enum value when valid, `false` when invalid. */
function optionalEnum<T extends string>(
  params: AdminSearchParams,
  key: string,
  values: readonly T[],
): T | null | false {
  const raw = singleAdminParam(params, key);
  if (raw === undefined || raw === "") return null;
  if (raw === null) return false;
  return isOneOf(values, raw) ? raw : false;
}

/** `undefined` when absent, the trimmed value when valid, `false` when invalid. */
function optionalTrimmedString(
  params: AdminSearchParams,
  key: string,
  maxLength: number,
): string | null | false {
  const raw = singleAdminParam(params, key);
  if (raw === undefined) return null;
  if (raw === null) return false;
  const value = raw.trim();
  if (value === "") return null;
  if (value.length > maxLength) return false;
  return value;
}

function parseLimit(params: AdminSearchParams): number | null {
  const raw = singleAdminParam(params, "limit");
  if (raw === undefined || raw === "") return ADMIN_DEFAULT_PAGE_LIMIT;
  if (raw === null || !/^\d{1,3}$/u.test(raw)) return null;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_MAX_PAGE_LIMIT) return null;
  return limit;
}

function parseCursor(params: AdminSearchParams): string | null | false {
  const raw = singleAdminParam(params, "cursor");
  if (raw === undefined || raw === "") return null;
  if (raw === null || raw.length > 512) return false;
  return raw;
}
