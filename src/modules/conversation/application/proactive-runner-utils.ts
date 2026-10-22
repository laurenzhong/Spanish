import { z } from "zod";

const userIdSchema = z.uuid();
export const luciaProactiveTimeZone = "Europe/Madrid";

export function parseLuciaProactiveUserIds(raw = process.env.LUCIA_PROACTIVE_USER_IDS): readonly string[] {
  if (!raw?.trim()) throw new Error("LUCIA_PROACTIVE_USER_IDS is required.");
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const parsed = z.array(userIdSchema).min(1).safeParse(values);
  if (!parsed.success) throw new Error("LUCIA_PROACTIVE_USER_IDS must be a comma-separated list of UUIDs.");
  return [...new Set(parsed.data.map((value) => value.toLowerCase()))];
}

export function formatNaturalDate(value: Date, timeZone = luciaProactiveTimeZone): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to determine the proactive natural date.");
  return `${year}-${month}-${day}`;
}

export type LuciaProactiveSlot = Readonly<{
  index: number;
  targetMinutes: number;
  sourceEventId: string;
  dailyState: "waking" | "available";
}>;

const proactiveWindows = [
  { startMinutes: 9 * 60, endMinutes: 10 * 60 + 30 },
  { startMinutes: 14 * 60 + 30, endMinutes: 16 * 60 },
  { startMinutes: 20 * 60, endMinutes: 21 * 60 + 30 },
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function naturalMinutes(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const hour = Number(parts.find((entry) => entry.type === "hour")?.value);
  const minute = Number(parts.find((entry) => entry.type === "minute")?.value);
  return hour * 60 + minute;
}

export function getLuciaProactiveSlots(userId: string, date: string): readonly LuciaProactiveSlot[] {
  return proactiveWindows.map((window, index) => {
    const targetMinutes = window.startMinutes + stableHash(`${userId}:${date}:${index}`) % (window.endMinutes - window.startMinutes);
    return { index, targetMinutes, sourceEventId: `${date}:slot-${index + 1}`, dailyState: index === 0 ? "waking" : "available" };
  });
}

export function getDueLuciaProactiveSlots(input: Readonly<{ userId: string; now: Date; timeZone?: string }>): readonly LuciaProactiveSlot[] {
  const timeZone = input.timeZone ?? luciaProactiveTimeZone;
  const date = formatNaturalDate(input.now, timeZone);
  const minutes = naturalMinutes(input.now, timeZone);
  return getLuciaProactiveSlots(input.userId, date).filter((slot) => slot.targetMinutes <= minutes);
}

/**
 * postgres.js fetches array type OIDs on a connection's first statement
 * (`fetch_types`, enabled by default) with an internal catalog query whose
 * promise it does not retain. A server-side cancellation of that internal
 * statement (for example a transient `57014 statement timeout`) therefore
 * surfaces as an unhandled rejection and kills the scheduled process before
 * the runner can report its own JSON result. The runner only reads scalar and
 * JSON columns, so it disables the internal lookup through the connection URL;
 * every other consumer keeps the postgres.js default.
 */
export function scheduledProactiveDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set("fetch_types", "false");
  return url.toString();
}

/**
 * One stable JSON line for process-level failures. Postgres errors carry their
 * SQLSTATE as `code`; keeping it here distinguishes a transient server
 * cancellation from a configuration or code bug without logging message text.
 */
export function proactiveFailurePayload(reason: string, error: unknown): string {
  const message = error instanceof Error ? error.message : "Lucía proactive run failed.";
  const rawCode = typeof (error as { code?: unknown } | null)?.code === "string"
    ? (error as { code: string }).code
    : null;
  // Only SQLSTATEs are forwarded; application errors such as
  // CHARACTER_RUNTIME_UNAVAILABLE also expose a `code`, but it is not a
  // database status and would mislead a "transient?" diagnosis.
  const pgCode = rawCode && /^[0-9A-Z]{5}$/u.test(rawCode) ? rawCode : null;
  return JSON.stringify({
    code: "LUCIA_PROACTIVE_FAILED",
    reason,
    message: message.slice(0, 500),
    ...(pgCode ? { pgCode } : {}),
  });
}
