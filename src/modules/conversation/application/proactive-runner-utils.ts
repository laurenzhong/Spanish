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
