import { describe, expect, it, vi } from "vitest";

// Regression: the activity route only accepted a Bearer token, so every
// heartbeat from the cookie-authenticated web app was answered
// 401 AUTH_REQUIRED. Verified in a real browser: the client posted a valid
// `active` event and nothing reached the database. The sibling
// profile/heatmap route has always resolved the cookie session too.

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  verifyRequestUser: vi.fn(async () => null),
  recordLearningActivity: vi.fn(async () => ({ accepted: true })),
}));

vi.mock("@/src/shared/auth/server", () => ({
  getCurrentUser: mocks.getCurrentUser,
  verifyRequestUser: mocks.verifyRequestUser,
}));

vi.mock("@/src/modules/profile/application", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/src/modules/profile/application");
  return {
    ...actual,
    recordLearningActivity: mocks.recordLearningActivity,
    recordLearningActivityInputSchema: { safeParse: () => ({ success: true, data: { clientInstanceId: "c", eventType: "active", sequence: 0 } }) },
  };
});

vi.mock("@/src/modules/profile/repositories", () => ({ createDrizzleProfileRepository: () => ({}) }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: () => ({}) }));

import { POST } from "@/app/api/v1/practice/sessions/[sessionId]/activity/route";

function requestWithCookies(hasCookies: boolean) {
  const cookie = hasCookies
    ? [{ name: "sb-project-auth-token", value: "x".repeat(40) }]
    : [];
  return {
    headers: new Headers(),
    cookies: { getAll: () => cookie },
    json: async () => ({ clientInstanceId: "c", eventType: "active", sequence: 0 }),
  } as never;
}

const context = { params: Promise.resolve({ sessionId: "22222222-2222-4222-8222-222222222222" }) };

describe("learning activity route auth", () => {
  it("accepts a cookie-authenticated heartbeat instead of answering 401", async () => {
    mocks.verifyRequestUser.mockResolvedValueOnce(null);
    const response = await POST(requestWithCookies(true), context);
    expect(response.status).not.toBe(401);
    expect(mocks.recordLearningActivity).toHaveBeenCalledTimes(1);
  });

  it("still refuses a request with no credentials at all", async () => {
    mocks.verifyRequestUser.mockResolvedValueOnce(null);
    const response = await POST(requestWithCookies(false), context);
    expect(response.status).toBe(401);
  });
});
