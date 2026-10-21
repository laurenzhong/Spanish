import { localDateInTimeZone } from "./local-date";

/**
 * The greeting that opens a message, normalized to accent-free lowercase form,
 * or null when the message does not open with one. Leading emoji and
 * punctuation are skipped, so "Buenas tardes 😊 …" counts as a greeting.
 */
export function greetingOpener(value: string): string | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/^[^\p{L}]+/u, "");
  const timed = /^(?:buenos\s+dias|buenas\s+tardes|buenas\s+noches)/u.exec(normalized);
  if (timed) return timed[0];
  const generic = /^(?:hola|hey|buenas|que\s+tal)\b/u.exec(normalized);
  if (!generic) return null;
  // "Buenas noticias…" is not a greeting: a bare "buenas" only greets when
  // nothing but punctuation follows it.
  if (generic[0] === "buenas" && /^\s*\p{L}/u.test(normalized.slice(generic[0].length))) return null;
  return generic[0];
}

export type GreetingHistoryMessage = Readonly<{
  role: "user" | "character";
  content: string;
  sentAt?: string;
}>;

/**
 * True when the character has already greeted the user on `localDate`.
 *
 * A greeting opens a conversation; it is not a per-message decoration. Once
 * the character has greeted the user on the current local day, a later message
 * that only continues the exchange must not open with another greeting.
 *
 * The whole day is scanned, not just the immediately previous message: an
 * intervening non-greeting reply does not undo the earlier greeting. A
 * reported 2026-10-21 transcript greeted at 16:40, sent non-greeting replies,
 * and greeted again at 16:58 because the old check only looked at the single
 * previous message (the "Uff, los días de lluvia…" reply).
 *
 * Messages without a parseable timestamp are ignored: a same-day repeat must
 * never be assumed when the evidence is missing.
 */
export function hasGreetedOnLocalDate(
  messages: readonly GreetingHistoryMessage[],
  localDate: string,
  timeZone: string,
): boolean {
  return messages.some((message) => message.role === "character"
    && greetingOpener(message.content) !== null
    && message.sentAt !== undefined
    && localDateInTimeZone(message.sentAt, timeZone) === localDate);
}
