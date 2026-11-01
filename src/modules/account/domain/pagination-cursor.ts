/**
 * Cursor pagination codec shared by the account-admin list endpoints
 * (ACCT-ADMIN-001). Cursors are opaque to clients:
 * `base64url(JSON{v:1, createdAt, id})`, sorted `createdAt desc, id desc`.
 *
 * Pure TypeScript; uses the web-standard base64url alphabet (no Node Buffer) so
 * the codec works in any server runtime and is straightforward to unit test.
 */

export type ListCursor = Readonly<{ createdAt: Date; id: string }>;

type CursorPayload = Readonly<{ v: 1; createdAt: string; id: string }>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const MAX_CURSOR_LENGTH = 512;

function toBase64Url(value: string): string {
  const binary = btoa(value);
  return binary.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid-cursor");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}

export function encodeListCursor(cursor: ListCursor): string {
  const payload: CursorPayload = {
    v: 1,
    createdAt: cursor.createdAt.toISOString(),
    id: cursor.id,
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Returns `null` for malformed/out-of-range cursors; callers map that to 400. */
export function decodeListCursor(value: string): ListCursor | null {
  if (!value || value.length > MAX_CURSOR_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const payload = parsed as Partial<CursorPayload>;
  if (payload.v !== 1) return null;
  if (typeof payload.id !== "string" || !UUID_PATTERN.test(payload.id)) {
    return null;
  }
  if (typeof payload.createdAt !== "string") return null;
  const createdAt = new Date(payload.createdAt);
  if (Number.isNaN(createdAt.valueOf())) return null;
  return { createdAt, id: payload.id };
}
