import { AdminActionError } from "../errors";

/**
 * Pure domain rules for the owner regulatory console (ACCT-ADMIN-001 slice B).
 *
 * Everything here is deterministic and I/O free: window resolution, cursor
 * encoding, ratio/health classification and the small pure formatting helpers
 * used by the admin read model. SQL aggregation lives in the repository.
 */

/** Windows accepted by the overview and content-health endpoints (design §5.4). */
export const ADMIN_WINDOWS = ["24h", "7d", "30d"] as const;

export type AdminWindow = (typeof ADMIN_WINDOWS)[number];

/** Account role/status vocabularies exposed by the account model (ADR-0021 §3). */
export const ADMIN_USER_ROLES = ["owner", "member"] as const;
export const ADMIN_USER_STATUSES = ["active", "suspended"] as const;

/** Candidate acquisition buckets (content-acquisition domain). */
export const ADMIN_CANDIDATE_STATUSES = [
  "discovered",
  "screened",
  "acquiring",
  "processing",
  "review_ready",
  "failed",
  "rejected",
] as const;

export type AdminCandidateStatus = (typeof ADMIN_CANDIDATE_STATUSES)[number];

/**
 * Diagnostic event types that the observability module writes; the console reads
 * only these fixed values (architecture §8) and never the event metadata.
 */
export const DIAGNOSTIC_EVENT_TYPES = [
  "conversation.stream_failed",
  "evidence.duplicate",
  "memory.conflict",
  "privacy.storage_cleanup_failed",
] as const;

export type DiagnosticEventType = (typeof DIAGNOSTIC_EVENT_TYPES)[number];

export const DIAGNOSTIC_SEVERITIES = ["warning", "alert"] as const;
export type DiagnosticSeverity = (typeof DIAGNOSTIC_SEVERITIES)[number];

export const DIAGNOSTIC_STATUSES = ["open", "acknowledged", "resolved"] as const;
export type DiagnosticStatus = (typeof DIAGNOSTIC_STATUSES)[number];

/** The only legal diagnostic triage transitions (design §5.4). */
export const DIAGNOSTIC_ACKNOWLEDGE_TARGETS = ["acknowledged", "resolved"] as const;
export type DiagnosticAcknowledgeTarget =
  (typeof DIAGNOSTIC_ACKNOWLEDGE_TARGETS)[number];

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export const ADMIN_WINDOW_DURATIONS_MS: Readonly<Record<AdminWindow, number>> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/** Default range for the AI usage endpoint when `from`/`to` are omitted. */
export const ADMIN_DEFAULT_RANGE_MS = 30 * DAY_MS;

/** Hard cap for `GET /api/v1/admin/ai-usage` time ranges (design §5.4). */
export const ADMIN_MAX_RANGE_MS = 90 * DAY_MS;

/**
 * A `running` acquisition run older than this is reported as stale. Acquisition
 * runs are expected to finish within minutes; one hour keeps a slow but healthy
 * run out of the alert bucket without hiding genuinely abandoned runs.
 */
export const ACQUISITION_RUN_STALE_AFTER_MS = HOUR_MS;

/** Default page size for every cursor list in the console. */
export const ADMIN_DEFAULT_PAGE_LIMIT = 20;
/** Hard maximum page size accepted by the admin query schemas. */
export const ADMIN_MAX_PAGE_LIMIT = 100;

export type AdminWindowRange = Readonly<{
  window: AdminWindow;
  from: Date;
  to: Date;
}>;

/**
 * Resolve a named window to a half-open-ish inclusive `[from, to]` range anchored
 * at `now`. The console reports "last 24h/7d/30d" so both ends are inclusive in
 * SQL; `to` is the request instant.
 */
export function resolveAdminWindow(
  window: AdminWindow,
  now: Date = new Date(),
): AdminWindowRange {
  assertValidDate(now, "The admin request time is invalid.");
  const to = new Date(now.getTime());
  return {
    window,
    from: new Date(to.getTime() - ADMIN_WINDOW_DURATIONS_MS[window]),
    to,
  };
}

export type AdminTimeRangeInput = Readonly<{
  from?: Date | null;
  to?: Date | null;
}>;

export type AdminTimeRange = Readonly<{ from: Date; to: Date }>;

/**
 * Resolve the explicit AI-usage range. Defaults: last 30 days ending now. A
 * range longer than 90 days or an inverted range is rejected as a validation
 * error (route maps it to `400 VALIDATION_FAILED`).
 */
export function resolveAdminTimeRange(
  input: AdminTimeRangeInput = {},
  now: Date = new Date(),
): AdminTimeRange {
  assertValidDate(now, "The admin request time is invalid.");
  const to = input.to ?? now;
  const from =
    input.from ?? new Date(to.getTime() - ADMIN_DEFAULT_RANGE_MS);
  assertValidDate(from, "The requested time range start is invalid.");
  assertValidDate(to, "The requested time range end is invalid.");
  if (from.getTime() > to.getTime()) {
    throw new AdminActionError(
      "VALIDATION_FAILED",
      "The requested time range is inverted.",
      400,
    );
  }
  if (to.getTime() - from.getTime() > ADMIN_MAX_RANGE_MS) {
    throw new AdminActionError(
      "VALIDATION_FAILED",
      "The requested time range must not exceed 90 days.",
      400,
    );
  }
  return { from, to };
}

export type AdminHealthStatus = "healthy" | "degraded" | "critical";

export type AdminHealthInput = Readonly<{
  /** Diagnostic events still in the `open` status. */
  openDiagnostics: number;
  /** Diagnostic events with severity `alert` inside the reporting window. */
  alertDiagnostics: number;
  /** Storage cleanup tasks that exhausted their retries. */
  storageCleanupFailed: number;
  /** Acquisition runs that failed inside the reporting window. */
  failedAcquisitionRuns: number;
  /** Acquisition runs stuck in `running` past the stale threshold. */
  staleAcquisitionRuns: number;
}>;

/**
 * Classify the platform health shown on the overview page.
 *
 * Rules (locked by tests):
 *   critical: any open diagnostic or failed storage cleanup task;
 *   degraded: alert diagnostics in the window or failed/stale acquisition runs;
 *   healthy: none of the above.
 *
 * This is an operational signal only; it is never a learning-capability fact.
 */
export function classifyAdminHealth(input: AdminHealthInput): AdminHealthStatus {
  if (input.openDiagnostics > 0 || input.storageCleanupFailed > 0) {
    return "critical";
  }
  if (
    input.alertDiagnostics > 0 ||
    input.failedAcquisitionRuns > 0 ||
    input.staleAcquisitionRuns > 0
  ) {
    return "degraded";
  }
  return "healthy";
}

/** Round a ratio to four decimals so responses stay stable and readable. */
export function roundAdminRatio(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export type ProviderFailureInput = Readonly<{
  succeeded: number;
  failed: number;
  cancelled: number;
}>;

/**
 * Provider-call failure rate: `failed / (succeeded + failed + cancelled)`.
 * In-flight (`started`) calls are excluded so a busy moment is not reported as
 * a failure (design §5.4). Returns `null` when there is no completed sample.
 */
export function computeFailureRate(input: ProviderFailureInput): number | null {
  const denominator = input.succeeded + input.failed + input.cancelled;
  if (denominator <= 0) return null;
  return roundAdminRatio(input.failed / denominator);
}

export type CostCoverageInput = Readonly<{
  calls: number;
  callsWithCost: number;
}>;

/**
 * Cost coverage: the share of provider calls that recorded an estimated cost.
 * Costs are sparse because TTS/STT/transcription do not write `provider_calls`
 * yet, so the console must show the coverage instead of inventing a total.
 */
export function computeCostCoverageRatio(input: CostCoverageInput): number | null {
  if (input.calls <= 0) return null;
  const known = Math.min(Math.max(input.callsWithCost, 0), input.calls);
  return roundAdminRatio(known / input.calls);
}

export type AdminCursor = Readonly<{
  /**
   * ISO-8601 UTC timestamp with microsecond precision (as rendered by the
   * repository). Fetching it as text keeps cursor comparisons exact: a JS `Date`
   * only carries milliseconds while PostgreSQL stores microseconds.
   */
  createdAt: string;
  id: string;
}>;

const CURSOR_VERSION = 1;
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += BASE64URL_ALPHABET[first >> 2];
    output += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second !== undefined) {
      output += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    }
    if (third !== undefined) {
      output += BASE64URL_ALPHABET[third & 0x3f];
    }
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return null;
  const output: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    const index = BASE64URL_ALPHABET.indexOf(character);
    if (index < 0) return null;
    buffer = ((buffer << 6) | index) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }
  // Reject non-canonical trailing bits rather than accepting many encodings of
  // the same cursor, which would make pagination harder to reason about.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return new Uint8Array(output);
}

/**
 * Encode the opaque cursor used by every admin list:
 * `base64url(JSON{v:1, createdAt, id})` (design §5.4).
 */
export function encodeAdminCursor(cursor: AdminCursor): string {
  return encodeBase64Url(
    utf8Encoder.encode(
      JSON.stringify({
        v: CURSOR_VERSION,
        createdAt: cursor.createdAt,
        id: cursor.id,
      }),
    ),
  );
}

/** Decode an opaque admin cursor; malformed input returns `null`. */
export function decodeAdminCursor(value: string): AdminCursor | null {
  if (value.length === 0 || value.length > 512) return null;
  const bytes = decodeBase64Url(value);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decoder.decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== CURSOR_VERSION) return null;
  if (
    typeof record.createdAt !== "string" ||
    record.createdAt.length < 10 ||
    record.createdAt.length > 40 ||
    Number.isNaN(new Date(record.createdAt).getTime())
  ) {
    return null;
  }
  if (typeof record.id !== "string" || record.id.length === 0 || record.id.length > 200) {
    return null;
  }
  return { createdAt: record.createdAt, id: record.id };
}

/**
 * Escape a user search term for a `LIKE`/`ILIKE` contains pattern. The repository
 * appends `ESCAPE '\'`, so `%`, `_` and `\` must be escaped here instead of being
 * treated as wildcards (which would let a search enumerate unrelated users).
 */
export function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

/** `%term%` pattern for a masked, non-enumerating user search. */
export function buildLikeContainsPattern(value: string): string {
  return `%${escapeLikePattern(value)}%`;
}

/**
 * Mask an invited email for the console. The database still stores the
 * normalized address for invite matching, but the console only ever shows a
 * masked local part such as `a***@example.com` (design §5.4, §7).
 */
export function maskEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0) return "***";
  const local = normalized.slice(0, atIndex);
  const domain = normalized.slice(atIndex);
  return `${local.slice(0, 1)}***${domain}`;
}

function assertValidDate(value: Date, message: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new AdminActionError("VALIDATION_FAILED", message, 400);
  }
}

/**
 * Cursor decoding for list endpoints: an absent cursor stays `null`, a malformed
 * one becomes the stable `400 VALIDATION_FAILED` error (design §5.4).
 */
export function decodeAdminCursorOrThrow(
  value: string | undefined,
): AdminCursor | null {
  if (value === undefined) return null;
  const cursor = decodeAdminCursor(value);
  if (!cursor) {
    throw new AdminActionError(
      "VALIDATION_FAILED",
      "The pagination cursor is invalid.",
      400,
    );
  }
  return cursor;
}

/** ISO-8601 serialization used by every admin DTO date field. */
export function toIsoStringOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * Diagnostic triage only moves forward: `open -> acknowledged -> resolved`.
 * Repeating a status or skipping a step is a conflict (409), not a no-op.
 */
export function isLegalDiagnosticTransition(
  from: DiagnosticStatus,
  to: "acknowledged" | "resolved",
): boolean {
  return (
    (from === "open" && to === "acknowledged") ||
    (from === "acknowledged" && to === "resolved")
  );
}

/** Audit action recorded for a successful diagnostic triage transition. */
export function diagnosticAuditActionForStatus(
  status: "acknowledged" | "resolved",
): "diagnostic.acknowledge" | "diagnostic.resolve" {
  return status === "acknowledged" ? "diagnostic.acknowledge" : "diagnostic.resolve";
}
