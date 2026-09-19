import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClient, getUser, readSupabasePublicConfig } = vi.hoisted(
  () => ({
    createServerClient: vi.fn(),
    getUser: vi.fn(),
    readSupabasePublicConfig: vi.fn(() => ({
      url: "https://example.supabase.co",
      publishableKey: "publishable-key",
    })),
  }),
);

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/src/shared/auth/config", () => ({ readSupabasePublicConfig }));

import { proxy } from "@/proxy";

function request() {
  return new NextRequest("http://localhost/learn", {
    headers: { cookie: "sb-project-auth-token=stale-token" },
  });
}

describe("proxy authentication failure classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerClient.mockReturnValue({ auth: { getUser } });
  });

  it("redirects an invalid session to login instead of showing an outage", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { name: "AuthApiError", status: 401, message: "Invalid JWT" },
    });

    const response = await proxy(request());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?next=%2Flearn",
    );
  });

  it("keeps a reloadable response for transient auth outages", async () => {
    getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { name: "AuthRetryableFetchError", message: "Failed to fetch" },
    });

    const response = await proxy(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-auth-next-path")).toBe("/learn");
  });

  it("does not classify a slow but successful auth lookup as an outage", async () => {
    getUser.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve({
        data: { user: { id: "user-1" } },
        error: null,
      }), 800)),
    );

    const response = await proxy(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-auth-next-path")).toBeNull();
  });
});
