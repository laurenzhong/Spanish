// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ database: vi.fn(), verify: vi.fn() }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.database }));
vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verify, getCurrentUser: vi.fn() }));

import {
  archivedSeriesE2eKey, createMediaSeriesE2eRepository, emptySeriesE2eKey,
  getMediaSeriesE2eCard, getMediaSeriesE2eSummary, podcastSeriesE2eKey, videoSeriesE2eKey,
} from "@/src/modules/media/testing/media-series-e2e-fixture";
import * as videoFixtures from "@/src/modules/media/testing/video-learning-e2e-fixture";
import * as podcastFixtures from "@/src/modules/media/testing/podcast-learning-e2e-fixture";
import { mediaSeriesRepository } from "@/src/modules/media/http/series-http";
import { GET as getEpisodes } from "@/app/api/v1/media-series/[seriesKey]/episodes/route";

const userId = "00000000-0000-4000-8000-000000000001";

describe("deterministic media series E2E catalogue", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AUTH_E2E_ENABLED", "1");
    vi.stubEnv("DATABASE_URL", "");
    vi.clearAllMocks();
    mocks.database.mockImplementation(() => { throw new Error("Fixture unexpectedly accessed database"); });
    mocks.verify.mockResolvedValue({ id: userId, email: null });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires both an enabled E2E flag and nonproduction runtime", async () => {
    const retained = createMediaSeriesE2eRepository()!;
    for (const [environment, enabled] of [["production", "1"], ["test", "0"], ["development", ""]]) {
      vi.stubEnv("NODE_ENV", environment);
      vi.stubEnv("AUTH_E2E_ENABLED", enabled);
      expect(createMediaSeriesE2eRepository()).toBeNull();
      expect(getMediaSeriesE2eSummary("youtube.e2e-cafe")).toBeNull();
      expect(getMediaSeriesE2eCard("youtube.e2e-cafe")).toBeNull();
      expect(videoFixtures.getVideoLearningE2eFixture("video.e2e-series-01")).toBeNull();
      expect(podcastFixtures.getPodcastLearningE2eFixture("podcast.e2e-series-01")).toBeNull();
      await expect(retained.getSeries(videoSeriesE2eKey, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_UNAVAILABLE" });
    }
  });

  it("returns all 25 video cards over bounded pages and locates an anchor beyond the first page", async () => {
    const repository = createMediaSeriesE2eRepository()!;
    const first = await repository.listEpisodes(videoSeriesE2eKey, { pageSize: 20 }, userId);
    expect(first.series.episodeCount).toBe(25);
    expect(first.items).toHaveLength(20);
    expect(first.hasMore).toBe(true);
    const second = await repository.listEpisodes(videoSeriesE2eKey, { pageSize: 20, cursor: first.nextCursor! }, userId);
    expect(second.items).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    expect(new Set([...first.items, ...second.items].map((item) => item.stableKey)).size).toBe(25);
    const anchored = await repository.listEpisodes(videoSeriesE2eKey, { pageSize: 20, anchorMediaKey: "video.e2e-native" }, userId);
    expect(anchored.items.map((item) => item.stableKey)).toContain("video.e2e-native");
    expect(anchored.anchor.current?.stableKey).toBe("video.e2e-native");
    expect(anchored.anchor.previous?.stableKey).toBe("video.e2e-series-23");
    expect(anchored.anchor.next?.stableKey).toBe("youtube.e2e-cafe");
    await expect(repository.listEpisodes(videoSeriesE2eKey, { pageSize: 10, cursor: first.nextCursor! }, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_CURSOR_INVALID" });
    await expect(repository.listEpisodes(videoSeriesE2eKey, { pageSize: 20, anchorMediaKey: "podcast.e2e-cafe" }, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_QUERY_INVALID" });
  });

  it("serves series API reads without database or playback transcript reads", async () => {
    const video = vi.spyOn(videoFixtures, "getVideoLearningE2eFixture");
    const podcast = vi.spyOn(podcastFixtures, "getPodcastLearningE2eFixture");
    expect(mediaSeriesRepository()).toBeDefined();
    const response = await getEpisodes(new NextRequest("http://localhost/api/v1/media-series/series.e2e-video/episodes?anchorMediaKey=video.e2e-native"), {
      params: Promise.resolve({ seriesKey: videoSeriesE2eKey }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.series.episodeCount).toBe(25);
    expect(body.data.anchor.current.stableKey).toBe("video.e2e-native");
    expect(body.data.items.every((item: object) => !("segments" in item) && !("asset" in item))).toBe(true);
    expect(mocks.database).not.toHaveBeenCalled();
    expect(video).not.toHaveBeenCalled();
    expect(podcast).not.toHaveBeenCalled();
  });

  it("provides podcast, empty and unavailable scenarios and refuses every fake write", async () => {
    const repository = createMediaSeriesE2eRepository()!;
    const podcast = await repository.listEpisodes(podcastSeriesE2eKey, { pageSize: 20, anchorMediaKey: "podcast.e2e-cafe" }, userId);
    expect(podcast.items).toHaveLength(3);
    expect(podcast.anchor.previous?.stableKey).toBe("podcast.e2e-series-01");
    expect(podcast.anchor.next?.stableKey).toBe("podcast.e2e-series-03");
    expect((await repository.listEpisodes(emptySeriesE2eKey, { pageSize: 20 }, userId)).items).toEqual([]);
    await expect(repository.getSeries(archivedSeriesE2eKey, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_NOT_AVAILABLE" });
    await expect(repository.save(videoSeriesE2eKey, {} as never, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_UNAVAILABLE" });
    const recommended = await repository.recommendations("video.e2e-native", userId);
    expect(recommended.items).toHaveLength(6);
    expect(recommended.items[0].stableKey).toBe("youtube.e2e-cafe");
    expect(recommended.items.some((item) => item.stableKey === "video.e2e-native")).toBe(false);
  });

  it("keeps playback available for every selectable fixture while leaving standalone fixtures ungrouped", () => {
    for (let episode = 1; episode <= 23; episode += 1) {
      const stableKey = `video.e2e-series-${String(episode).padStart(2, "0")}`;
      const playback = videoFixtures.getVideoLearningE2eFixture(stableKey)!;
      expect(playback.media.series?.seriesKey).toBe(videoSeriesE2eKey);
      expect(playback.media.title).toBe(getMediaSeriesE2eCard(stableKey)?.title);
      expect(playback.segments).toHaveLength(3);
      expect(playback.asset.kind).toBe("video");
    }
    for (const stableKey of ["podcast.e2e-series-01", "podcast.e2e-cafe", "podcast.e2e-series-03"]) {
      expect(podcastFixtures.getPodcastLearningE2eFixture(stableKey)?.media.series?.seriesKey).toBe(podcastSeriesE2eKey);
    }
    expect(videoFixtures.getVideoLearningE2eFixture("video.e2e-long-transcript")?.media.series).toBeNull();
    expect(podcastFixtures.getPodcastLearningE2eFixture("podcast.e2e-long-transcript")?.media.series).toBeNull();
    expect(podcastFixtures.getPodcastLearningE2eFixture("podcast.e2e-loading")?.media.series).toBeNull();
  });

  it("provides saved progress for the first series video without changing native or cafe starting positions", () => {
    expect(videoFixtures.getVideoLearningE2eFixture("video.e2e-series-01")?.media.progress).toEqual({ lastPositionMs: 1_000, lastSegmentIndex: 0, status: "in_progress", revision: 1 });
    for (const stableKey of [videoFixtures.nativeVideoLearningE2eStableKey, videoFixtures.videoLearningE2eStableKey, "video.e2e-series-02"]) {
      expect(videoFixtures.getVideoLearningE2eFixture(stableKey)?.media.progress).toEqual({ lastPositionMs: 0, lastSegmentIndex: 0, status: "in_progress", revision: 0 });
    }
    const first = videoFixtures.getVideoLearningE2eFixture("video.e2e-series-01")!;
    const nextRead = videoFixtures.getVideoLearningE2eFixture("video.e2e-series-01")!;
    expect(nextRead.media.progress).not.toBe(first.media.progress);
    expect(nextRead.media.progress).toEqual(first.media.progress);
  });
});
