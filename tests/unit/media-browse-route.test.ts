// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), verifyUser: vi.fn(), createRepository: vi.fn(), browse: vi.fn() }));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.currentUser, verifyRequestUser: mocks.verifyUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: () => ({}) }));
vi.mock("@/src/modules/media/repositories", async (original) => ({ ...await original<typeof import("@/src/modules/media/repositories")>(), createDrizzleMediaRepository: mocks.createRepository }));
import { POST } from "@/app/api/v1/media/browse/route";
const body = { filters: { kind: "podcast", cefr: "B1" }, seed: "00000000-0000-4000-8000-000000000001", exclude: ["media.test.seen"] };
const request = (value: unknown, authorization?: string) => new NextRequest("http://localhost/api/v1/media/browse", { method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(value) });
const originalDatabaseUrl = process.env.DATABASE_URL;
beforeEach(() => {
  vi.clearAllMocks(); process.env.DATABASE_URL = "postgresql://test.invalid/db";
  mocks.currentUser.mockResolvedValue({ id: "user-a" }); mocks.verifyUser.mockResolvedValue(null);
  mocks.createRepository.mockReturnValue({ browse: mocks.browse });
  mocks.browse.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
});
afterEach(() => { if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl; });
describe("read-only media browse API", () => {
  it("forwards bounded filters and current user, returns an uncached page", async () => {
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.browse).toHaveBeenCalledWith({ ...body, pageSize: 24 }, "user-a");
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", data: { items: [] }, page: { nextCursor: null, hasMore: false } });
  });
  it("rejects unauthenticated and invalid bearer requests without cookie fallback", async () => {
    const invalidBearer = await POST(request(body, "Bearer invalid"));
    expect(invalidBearer.status).toBe(401);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    mocks.currentUser.mockResolvedValue(null);
    expect((await POST(request(body))).status).toBe(401);
    expect(mocks.browse).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized browse parameters before reading media", async () => {
    for (const value of [{ ...body, seed: "invalid" }, { ...body, pageSize: 51 }, { ...body, exclude: Array(1001).fill("media.test.seen") }, { ...body, filters: { userId: "someone-else" } }]) {
      expect((await POST(request(value))).status).toBe(400);
    }
    const malformed = new NextRequest("http://localhost/api/v1/media/browse", { method: "POST", body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect(mocks.browse).not.toHaveBeenCalled();
  });
  it("reports cursor expiry and unavailable data honestly", async () => {
    mocks.browse.mockRejectedValueOnce(new Error("MEDIA_CURSOR_INVALID"));
    const stale = await POST(request(body));
    expect(stale.status).toBe(400);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED", retryable: false } });
    mocks.browse.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(request(body))).status).toBe(503);
    delete process.env.DATABASE_URL;
    expect((await POST(request(body))).status).toBe(503);
  });
});
