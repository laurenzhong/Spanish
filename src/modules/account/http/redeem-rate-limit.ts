import { createHash } from "node:crypto";

import type { NextRequest } from "next/server";

/**
 * Process-level IP rate limiting for the public invitation-redemption endpoint
 * (ACCT-ADMIN-001, design §3.4). This is deliberately a small in-process map: it
 * protects the local single-instance Alpha from trivial invitation guessing and
 * does not replace Supabase Auth's platform rate limits.
 *
 * Privacy: the raw IP address is never stored or logged. Callers pass a salted
 * SHA-256 prefix (`clientAddressHash`) and logs only ever contain that hash.
 */
export const REDEEM_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const REDEEM_RATE_LIMIT_MAX_ATTEMPTS = 10;
const MAX_TRACKED_CLIENTS = 10_000;

type AttemptWindow = { count: number; resetAt: number };

const attempts = new Map<string, AttemptWindow>();

export type RedeemRateLimitState = Readonly<{
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}>;

export function clientAddressHash(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
  return createHash("sha256")
    .update(`account-invitation-redeem:${address}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function prune(now: number): void {
  if (attempts.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, window] of attempts) {
    if (window.resetAt <= now) attempts.delete(key);
  }
  while (attempts.size >= MAX_TRACKED_CLIENTS) {
    const oldest = attempts.keys().next();
    if (oldest.done) break;
    attempts.delete(oldest.value);
  }
}

/** Consume one attempt; returns `allowed: false` for the 11th+ attempt. */
export function consumeRedeemAttempt(
  clientHash: string,
  now: number = Date.now(),
): RedeemRateLimitState {
  let window = attempts.get(clientHash);
  if (!window || window.resetAt <= now) {
    window = { count: 0, resetAt: now + REDEEM_RATE_LIMIT_WINDOW_MS };
    attempts.set(clientHash, window);
    prune(now);
  }
  if (window.count >= REDEEM_RATE_LIMIT_MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }
  window.count += 1;
  return {
    allowed: true,
    remaining: REDEEM_RATE_LIMIT_MAX_ATTEMPTS - window.count,
    retryAfterSeconds: 0,
  };
}

/** A successful redemption clears the counter for that client hash. */
export function clearRedeemAttempts(clientHash: string): void {
  attempts.delete(clientHash);
}

/** Test-only reset so route tests start from a clean limiter. */
export function resetRedeemRateLimitState(): void {
  attempts.clear();
}
