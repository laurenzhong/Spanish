import { z } from "zod";

const userIdSchema = z.uuid();

export function parseLuciaProactiveUserIds(raw = process.env.LUCIA_PROACTIVE_USER_IDS): readonly string[] {
  if (!raw?.trim()) throw new Error("LUCIA_PROACTIVE_USER_IDS is required.");
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  const parsed = z.array(userIdSchema).min(1).safeParse(values);
  if (!parsed.success) throw new Error("LUCIA_PROACTIVE_USER_IDS must be a comma-separated list of UUIDs.");
  return [...new Set(parsed.data.map((value) => value.toLowerCase()))];
}

export function formatNaturalDate(value: Date, timeZone = "Asia/Shanghai"): string {
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
  const timeZone = input.timeZone ?? "Asia/Shanghai";
  const date = formatNaturalDate(input.now, timeZone);
  const minutes = naturalMinutes(input.now, timeZone);
  return getLuciaProactiveSlots(input.userId, date).filter((slot) => slot.targetMinutes <= minutes);
}
