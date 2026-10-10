import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import {
  type AccessTokenVerifier,
  getUserWithRetry,
  isRetryableAuthError,
  verifyRequestUser,
} from "@/src/shared/auth/server";
import { getRequestUser } from "@/src/shared/auth/request-user";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/v1/auth/session", {
    headers: authorization ? { authorization } : undefined,
  });
}

describe("verifyRequestUser", () => {
  it("rejects a request without a bearer token", async () => {
    const verify = vi.fn();
    expect(
      await verifyRequestUser(request(), { verify } as AccessTokenVerifier),
    ).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("rejects a token the authority cannot verify", async () => {
    const verify = vi.fn().mockResolvedValue(null);
    expect(
      await verifyRequestUser(request("Bearer invalid"), { verify }),
    ).toBeNull();
    expect(verify).toHaveBeenCalledWith("invalid");
  });

  it("returns only the identity verified by the authority", async () => {
    const user = {
      id: "00000000-0000-4000-8000-000000000001",
      email: "learner@example.test",
    };
    const verify = vi.fn().mockResolvedValue(user);

    await expect(
      verifyRequestUser(request("Bearer signed-token"), { verify }),
    ).resolves.toEqual(user);
  });

  it("does not let an explicit invalid bearer fall back to a cookie identity", async () => {
    const verifyRequest = vi.fn().mockResolvedValue(null);
    const getCookieUser = vi.fn().mockResolvedValue({ id: "cookie-user", email: null });
    const requestWithInvalidBearer = request("Bearer invalid");

    await expect(
      getRequestUser(requestWithInvalidBearer, {
        verifyRequestUser: verifyRequest,
        getCurrentUser: getCookieUser,
      }),
    ).resolves.toBeNull();
    expect(verifyRequest).toHaveBeenCalledTimes(1);
    expect(getCookieUser).not.toHaveBeenCalled();
  });

  it("uses the cookie identity only when Authorization is absent", async () => {
    const verifyRequest = vi.fn().mockResolvedValue(null);
    const getCookieUser = vi.fn().mockResolvedValue({ id: "cookie-user", email: null });

    await expect(
      getRequestUser(request(), {
        verifyRequestUser: verifyRequest,
        getCurrentUser: getCookieUser,
      }),
    ).resolves.toEqual({ id: "cookie-user", email: null });
    expect(getCookieUser).toHaveBeenCalledTimes(1);
  });
});

describe("getUserWithRetry", () => {
  it("retries a transient auth failure once", async () => {
    const readUser = vi
      .fn()
      .mockResolvedValueOnce({
        data: { user: null },
        error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
      })
      .mockResolvedValueOnce({
        data: { user: { id: "user-1", email: "learner@example.test" } },
        error: null,
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(getUserWithRetry(readUser, wait)).resolves.toEqual({
      data: { user: { id: "user-1", email: "learner@example.test" } },
      error: null,
    });
    expect(wait).toHaveBeenCalledWith(150);
    expect(readUser).toHaveBeenCalledTimes(2);
  });

  it("does not retry an invalid-session response", async () => {
    const readUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { name: "AuthApiError", status: 401, message: "Invalid JWT" },
    });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(getUserWithRetry(readUser, wait)).resolves.toEqual({
      data: { user: null },
      error: { name: "AuthApiError", status: 401, message: "Invalid JWT" },
    });
    expect(wait).not.toHaveBeenCalled();
    expect(readUser).toHaveBeenCalledTimes(1);
  });

  it("classifies service and network failures as retryable", () => {
    expect(isRetryableAuthError({ status: 503 })).toBe(true);
    expect(isRetryableAuthError({ message: "connection reset" })).toBe(true);
    expect(isRetryableAuthError({ status: 401 })).toBe(false);
    expect(isRetryableAuthError(null)).toBe(false);
  });
});
