/**
 * Calendar date of an instant in a given time zone, in `en-CA` shape
 * (`YYYY-MM-DD`). Returns `null` when the value cannot be parsed.
 *
 * Shared by the reply-context projections (`sameLocalDay`) and the same-day
 * greeting gate so both compare local days with the same conversion.
 */
export function localDateInTimeZone(value: string | Date, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}
