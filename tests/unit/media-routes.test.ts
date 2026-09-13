// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaProgressConflictError, MediaUnavailableError } from "@/src/modules/media";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  repository: {
    list: vi.fn(),
    findByStableKey: vi.fn(),
    getPlayback: vi.fn(),
    saveProgress: vi.fn(),
  },
}));

vi.mock("@/src/shared/auth/server", () => ({
  verifyRequestUser: mocks.verifyRequestUser,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/media/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/media/repositories")>();
  return { ...original, createDrizzleMediaRepository: mocks.createRepository };
});

import { GET as getMediaList } from "@/app/api/v1/media/route";
import { GET as getPlayback } from "@/app/api/v1/media/[stableKey]/playback/route";
import { PUT as putProgress } from "@/app/api/v1/media/[stableKey]/progress/route";

const user = { id: "00000000-0000-4000-8000-000000000001", email: null };
const requestId = "media_12345678";

function request(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(url, {
    ...init,
    headers: { "x-request-id": requestId, ...(init.headers ?? {}) },
  });
}

describe("media API routes", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.getDatabase.mockReturnValue({});
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("validates and forwards bounded list parameters", async () => {
    mocks.repository.list.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const response = await getMediaList(request("http://localhost/api/v1/media?kind=podcast&cefr=B1&duration=short&pageSize=12"));

    expect(response.status).toBe(200);
    expect(mocks.repository.list).toHaveBeenCalledWith(expect.objectContaining({ kind: "podcast", cefr: "B1", duration: "short", pageSize: 12 }), user.id);

    const invalid = await getMediaList(request("http://localhost/api/v1/media?pageSize=500"));
    expect(invalid.status).toBe(400);
    expect(mocks.repository.list).toHaveBeenCalledOnce();
  });

  it("requires authentication before issuing playback information", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const response = await getPlayback(request("http://localhost/api/v1/media/media.test/playback"), { params: Promise.resolve({ stableKey: "media.test" }) });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "AUTH_REQUIRED", requestId } });
    expect(mocks.repository.getPlayback).not.toHaveBeenCalled();
  });

  it("fails closed for withdrawn or expired playback", async () => {
    mocks.repository.getPlayback.mockRejectedValue(new MediaUnavailableError());
    const response = await getPlayback(request("http://localhost/api/v1/media/media.test/playback"), { params: Promise.resolve({ stableKey: "media.test" }) });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEDIA_NOT_AVAILABLE" } });
  });

  it("validates progress before repository access and requires authentication", async () => {
    const malformed = await putProgress(request("http://localhost/api/v1/media/media.test/progress", {
      method: "PUT",
      body: JSON.stringify({ version: 1, expectedRevision: -1 }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ stableKey: "media.test" }) });
    expect(malformed.status).toBe(400);
    expect(mocks.repository.saveProgress).not.toHaveBeenCalled();

    mocks.verifyRequestUser.mockResolvedValue(null);
    const unauthenticated = await putProgress(request("http://localhost/api/v1/media/media.test/progress", {
      method: "PUT",
      body: JSON.stringify({ version: 1, expectedRevision: 0, lastPositionMs: 1000, lastSegmentIndex: null, status: "in_progress" }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ stableKey: "media.test" }) });
    expect(unauthenticated.status).toBe(401);
  });

  it("returns a stable conflict without overwriting progress", async () => {
    mocks.repository.saveProgress.mockRejectedValue(new MediaProgressConflictError());
    const response = await putProgress(request("http://localhost/api/v1/media/media.test/progress", {
      method: "PUT",
      body: JSON.stringify({ version: 1, expectedRevision: 1, lastPositionMs: 2000, lastSegmentIndex: null, status: "in_progress" }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ stableKey: "media.test" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEDIA_PROGRESS_CONFLICT", retryable: false } });
  });
});
