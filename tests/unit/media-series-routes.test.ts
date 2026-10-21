// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MediaUnavailableError } from "@/src/modules/media/domain/media";
import { MediaSeriesError } from "@/src/modules/media/domain/media-series";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), currentUser: vi.fn(), database: vi.fn(), repository: {}, createRepository: vi.fn(),
  getSeries: vi.fn(), listEpisodes: vi.fn(), recommendations: vi.fn(), save: vi.fn(),
}));
vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verify, getCurrentUser: mocks.currentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.database }));
vi.mock("@/src/modules/media/repositories/drizzle-media-series-repository", () => ({ createDrizzleMediaSeriesRepository: mocks.createRepository }));
vi.mock("@/src/modules/media/application/media-series", () => ({
  getMediaSeries: mocks.getSeries, listMediaSeriesEpisodes: mocks.listEpisodes,
  getMediaSeriesRecommendations: mocks.recommendations, saveMediaSeries: mocks.save,
}));

import { GET as getSeries } from "@/app/api/v1/media-series/[seriesKey]/route";
import { GET as listEpisodes } from "@/app/api/v1/media-series/[seriesKey]/episodes/route";
import { GET as recommendations } from "@/app/api/v1/media/[stableKey]/series-recommendations/route";
import { PUT as saveSeries } from "@/app/api/v1/internal/content-workflow/media-series/[seriesKey]/route";

const user = { id: "00000000-0000-4000-8000-000000000001", email: null };
const context = () => ({ params: Promise.resolve({ seriesKey: "series.fixture" }) });
const mediaContext = () => ({ params: Promise.resolve({ stableKey: "media.fixture" }) });
const command = {
  idempotencyKey: "import-fixture-1", expectedRevision: 0, title: "Programa", summary: "", kind: "video",
  orderMode: "ordered", status: "active", reason: "Verified programme catalogue", evidence: ["https://example.test/programme"],
  members: [], removeStableKeys: [], fromSeriesRevisions: {},
};
function request(query = "", headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost/api/v1/media-series/series.fixture${query}`, { headers: { "x-request-id": "series-test-request", ...headers } });
}
function writeRequest(body: unknown = command) {
  return new NextRequest("http://localhost/api/v1/internal/content-workflow/media-series/series.fixture", {
    method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("media series authenticated protocol", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/db");
    vi.stubEnv("CONTENT_WORKFLOW_OWNER_USER_IDS", user.id);
    mocks.verify.mockResolvedValue(user);
    mocks.currentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.getSeries.mockResolvedValue({ seriesKey: "series.fixture", revision: 1, episodeCount: 2 });
    mocks.listEpisodes.mockResolvedValue({ items: [], anchor: { current: null, previous: null, next: null }, nextCursor: null, hasMore: false });
    mocks.recommendations.mockResolvedValue({ series: null, items: [] });
    mocks.save.mockResolvedValue({ seriesKey: "series.fixture", revision: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("authenticates every endpoint and marks success and errors private", async () => {
    const success = await getSeries(request(), context());
    expect(success.status).toBe(200);
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    expect(success.headers.get("x-request-id")).toBe("series-test-request");
    await expect(success.json()).resolves.toMatchObject({ apiVersion: "v1", data: { episodeCount: 2 } });
    expect(mocks.getSeries).toHaveBeenCalledWith(mocks.repository, "series.fixture", user.id);

    mocks.verify.mockResolvedValue(null);
    for (const response of [
      await getSeries(request(), context()), await listEpisodes(request(), context()),
      await recommendations(request(), mediaContext()), await saveSeries(writeRequest(), context()),
    ]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.listEpisodes).not.toHaveBeenCalled();
    expect(mocks.recommendations).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("accepts cookie sessions only when Authorization is absent", async () => {
    mocks.verify.mockResolvedValue(null);
    mocks.currentUser.mockResolvedValue(user);
    const response = await getSeries(request("", { cookie: "session=valid", authorization: "Bearer invalid" }), context());
    expect(response.status).toBe(401);
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.getSeries).not.toHaveBeenCalled();
    expect((await getSeries(request("", { cookie: "session=valid" }), context())).status).toBe(200);
    expect(mocks.currentUser).toHaveBeenCalledOnce();
  });

  it("returns retryable 503 for authentication outages without accessing catalogue", async () => {
    mocks.verify.mockRejectedValue(new Error("private provider failure"));
    const response = await getSeries(request(), context());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "MEDIA_SERIES_UNAVAILABLE", retryable: true } });
    expect(mocks.database).not.toHaveBeenCalled();
  });

  it("validates keys, bounded pagination and unknown query fields before database access", async () => {
    expect((await getSeries(request(), { params: Promise.resolve({ seriesKey: "../../private" }) })).status).toBe(400);
    for (const query of ["?pageSize=51", "?pageSize=0", "?cursor=", "?cursor=abc&anchorMediaKey=media.fixture", "?userId=another-user"]) {
      expect((await listEpisodes(request(query), context())).status).toBe(400);
    }
    expect(mocks.database).not.toHaveBeenCalled();
    const result = await listEpisodes(request("?pageSize=12&anchorMediaKey=media.fixture"), context());
    expect(result.status).toBe(200);
    expect(mocks.listEpisodes).toHaveBeenCalledWith(mocks.repository, "series.fixture", { pageSize: 12, anchorMediaKey: "media.fixture" }, user.id);
  });

  it("returns successful empty recommendations for a visible ungrouped media item", async () => {
    const response = await recommendations(request(), mediaContext());
    await expect(response.json()).resolves.toEqual({ apiVersion: "v1", data: { series: null, items: [] } });
    expect(mocks.recommendations).toHaveBeenCalledWith(mocks.repository, "media.fixture", user.id);
  });

  it("enforces the configured owner allowlist before parsing or writing", async () => {
    vi.stubEnv("CONTENT_WORKFLOW_OWNER_USER_IDS", "00000000-0000-4000-8000-000000000002");
    const response = await saveSeries(writeRequest("invalid-json"), context());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "CONTENT_WORKFLOW_FORBIDDEN" } });
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("validates complete bounded commands before forwarding owner identity", async () => {
    for (const invalid of ["invalid-json", { ...command, expectedRevision: -1 }, { ...command, members: Array(501).fill({}) }, { ...command, userId: user.id }]) {
      expect((await saveSeries(writeRequest(invalid), context())).status).toBe(400);
    }
    expect(mocks.database).not.toHaveBeenCalled();
    expect((await saveSeries(writeRequest(), context())).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(mocks.repository, "series.fixture", command, user.id);
  });

  it("rejects oversized announced or streamed commands before JSON parsing and cancels the stream", async () => {
    const announced = writeRequest();
    announced.headers.set("content-length", String(1024 * 1024 + 1));
    expect((await saveSeries(announced, context())).status).toBe(400);
    const cancel = vi.fn();
    const streamed = writeRequest();
    let chunks = 0;
    vi.spyOn(streamed, "body", "get").mockReturnValue(new ReadableStream({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(600_000).fill(32));
      },
      cancel,
    }));
    expect((await saveSeries(streamed, context())).status).toBe(400);
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBeLessThanOrEqual(3);
    expect(mocks.database).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ["MEDIA_SERIES_NOT_AVAILABLE", 404], ["MEDIA_SERIES_QUERY_INVALID", 400], ["MEDIA_SERIES_COMMAND_INVALID", 400],
    ["MEDIA_SERIES_CURSOR_INVALID", 400], ["MEDIA_SERIES_REVISION_CONFLICT", 409],
    ["MEDIA_SERIES_MEMBERSHIP_CONFLICT", 409], ["MEDIA_SERIES_IDEMPOTENCY_CONFLICT", 409], ["MEDIA_SERIES_UNAVAILABLE", 503],
  ] as const)("maps %s to a stable %s without leaking internals", async (code, status) => {
    mocks.getSeries.mockRejectedValue(new MediaSeriesError(code));
    const response = await getSeries(request(), context());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({ error: { code, retryable: status === 503 } });
  });

  it("maps withdrawn media to 404 and infrastructure failures to retryable 503", async () => {
    mocks.recommendations.mockRejectedValue(new MediaUnavailableError());
    const withdrawn = await recommendations(request(), mediaContext());
    expect(withdrawn.status).toBe(404);
    await expect(withdrawn.json()).resolves.toMatchObject({ error: { code: "MEDIA_NOT_AVAILABLE" } });
    delete process.env.DATABASE_URL;
    expect((await getSeries(request(), context())).status).toBe(503);
  });
});
