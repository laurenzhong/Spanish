// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  clearRedeemAttempts,
  clientAddressHash,
  consumeRedeemAttempt,
  REDEEM_RATE_LIMIT_MAX_ATTEMPTS,
  REDEEM_RATE_LIMIT_WINDOW_MS,
  resetRedeemRateLimitState,
} from "@/src/modules/account/http/redeem-rate-limit";
import {
  createSupabaseAccountProvisioner,
  readSupabaseAdminCredentials,
} from "@/src/modules/account/providers/supabase-admin-provisioner";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const saved = new Map<string, string | undefined>();

function setEnvironment(environment: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(environment)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
  resetRedeemRateLimitState();
});

describe("account provisioner credential resolution", () => {
  it("fails closed when the server secret or project url is missing", () => {
    setEnvironment({});
    expect(readSupabaseAdminCredentials(process.env)).toBeNull();
    expect(createSupabaseAccountProvisioner(process.env)).toBeNull();

    setEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    });
    expect(createSupabaseAccountProvisioner(process.env)).toBeNull();

    setEnvironment({ SUPABASE_SECRET_KEY: "secret" });
    expect(createSupabaseAccountProvisioner(process.env)).toBeNull();
  });

  it("prefers SUPABASE_SECRET_KEY and falls back to the legacy service role key", () => {
    setEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "secret-key",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    });
    expect(readSupabaseAdminCredentials(process.env)).toEqual({
      url: "https://project.supabase.co",
      secretKey: "secret-key",
    });
    expect(createSupabaseAccountProvisioner(process.env)).not.toBeNull();

    setEnvironment({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-key",
    });
    expect(readSupabaseAdminCredentials(process.env)).toEqual({
      url: "https://project.supabase.co",
      secretKey: "legacy-key",
    });
  });
});

describe("invitation redemption rate limiter", () => {
  const start = Date.parse("2026-10-21T12:00:00.000Z");

  it("hashes the client address and never exposes the raw IP", () => {
    const request = new NextRequest("http://localhost/api", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    const hash = clientAddressHash(request);
    expect(hash).toMatch(/^[a-f0-9]{16}$/u);
    expect(hash).not.toContain("203.0.113.7");
    expect(clientAddressHash(new NextRequest("http://localhost/api"))).toBe(
      clientAddressHash(new NextRequest("http://localhost/api")),
    );
  });

  it("allows ten attempts per window and reports retry-after", () => {
    for (let attempt = 0; attempt < REDEEM_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      expect(consumeRedeemAttempt("client-a", start).allowed).toBe(true);
    }
    const limited = consumeRedeemAttempt("client-a", start + 1_000);
    expect(limited.allowed).toBe(false);
    expect(limited.remaining).toBe(0);
    expect(limited.retryAfterSeconds).toBe(
      Math.ceil((REDEEM_RATE_LIMIT_WINDOW_MS - 1_000) / 1000),
    );
    // A different client has its own window.
    expect(consumeRedeemAttempt("client-b", start).allowed).toBe(true);
    // The window resets after ten minutes.
    expect(
      consumeRedeemAttempt("client-a", start + REDEEM_RATE_LIMIT_WINDOW_MS + 1)
        .allowed,
    ).toBe(true);
  });

  it("clears the counter after a successful redemption", () => {
    for (let attempt = 0; attempt < REDEEM_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      consumeRedeemAttempt("client-c", start);
    }
    expect(consumeRedeemAttempt("client-c", start).allowed).toBe(false);
    clearRedeemAttempts("client-c");
    expect(consumeRedeemAttempt("client-c", start).allowed).toBe(true);
  });
});
