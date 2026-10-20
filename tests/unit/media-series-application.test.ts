// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMediaSeries, getMediaSeriesRecommendations, listMediaSeriesEpisodes, saveMediaSeries } from "@/src/modules/media/application/media-series";
import { MediaSeriesError, type SaveMediaSeriesCommand } from "@/src/modules/media/domain/media-series";
import type { MediaSeriesRepository } from "@/src/modules/media/repositories/media-series-repository";
import { ContentWorkflowForbiddenError } from "@/src/shared/auth/content-workflow-owner";

const ownerId = "00000000-0000-4000-8000-000000000801";
const otherId = "00000000-0000-4000-8000-000000000802";
const series = { seriesKey: "series.madrid", title: "Madrid", summary: "Historias", kind: "video" as const, orderMode: "ordered" as const, status: "active" as const, revision: 1, episodeCount: 0 };
const command: SaveMediaSeriesCommand = {
  idempotencyKey: "series-command-001", expectedRevision: 0, title: "Madrid", summary: "Historias",
  kind: "video", orderMode: "ordered", status: "active", reason: "Confirmed official programme list",
  evidence: ["https://example.test/programme"], members: [], removeStableKeys: [], fromSeriesRevisions: {},
};
function makeRepository() {
  return {
    getSeries: vi.fn<MediaSeriesRepository["getSeries"]>().mockResolvedValue(series),
    listEpisodes: vi.fn<MediaSeriesRepository["listEpisodes"]>().mockResolvedValue({ series, items: [], anchor: { current: null, previous: null, next: null }, nextCursor: null, hasMore: false }),
    recommendations: vi.fn<MediaSeriesRepository["recommendations"]>().mockResolvedValue({ series, items: [] }),
    save: vi.fn<MediaSeriesRepository["save"]>().mockResolvedValue(series),
  };
}

describe("media series application boundary", () => {
  const previousOwners = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
  beforeEach(() => { process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = ownerId; });
  afterEach(() => {
    if (previousOwners === undefined) delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    else process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = previousOwners;
  });

  it("passes the authenticated user independently into every read", async () => {
    const repository = makeRepository();
    expect(await getMediaSeries(repository, series.seriesKey, ownerId)).toEqual(series);
    expect(await listMediaSeriesEpisodes(repository, series.seriesKey, {}, otherId)).toMatchObject({ series });
    expect(await getMediaSeriesRecommendations(repository, "video.madrid.01", ownerId)).toMatchObject({ series });
    expect(repository.getSeries).toHaveBeenCalledExactlyOnceWith(series.seriesKey, ownerId);
    expect(repository.listEpisodes).toHaveBeenCalledExactlyOnceWith(series.seriesKey, { pageSize: 20 }, otherId);
    expect(repository.recommendations).toHaveBeenCalledExactlyOnceWith("video.madrid.01", ownerId);
  });

  it("rejects malformed keys and UUIDs before any repository call", async () => {
    const repository = makeRepository();
    for (const key of ["../private", "", "series key", "x".repeat(201)]) {
      await expect(getMediaSeries(repository, key, ownerId)).rejects.toMatchObject({ code: "MEDIA_SERIES_QUERY_INVALID" });
      await expect(listMediaSeriesEpisodes(repository, key, {}, ownerId)).rejects.toBeInstanceOf(MediaSeriesError);
      await expect(getMediaSeriesRecommendations(repository, key, ownerId)).rejects.toBeInstanceOf(MediaSeriesError);
    }
    for (const userId of ["", "owner@example.test", "not-a-user"]) {
      await expect(getMediaSeries(repository, series.seriesKey, userId)).rejects.toMatchObject({ code: "MEDIA_SERIES_QUERY_INVALID" });
      await expect(listMediaSeriesEpisodes(repository, series.seriesKey, {}, userId)).rejects.toBeInstanceOf(MediaSeriesError);
      await expect(getMediaSeriesRecommendations(repository, "video.madrid.01", userId)).rejects.toBeInstanceOf(MediaSeriesError);
    }
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("revalidates bounded pagination and rejects client supplied user IDs", async () => {
    const repository = makeRepository();
    for (const query of [{ pageSize: 51 }, { cursor: "" }, { anchorMediaKey: "../media" }, { cursor: "valid-cursor", anchorMediaKey: "video.madrid.01" }, { userId: otherId }]) {
      await expect(listMediaSeriesEpisodes(repository, series.seriesKey, query, ownerId)).rejects.toMatchObject({ code: "MEDIA_SERIES_QUERY_INVALID" });
    }
    expect(repository.listEpisodes).not.toHaveBeenCalled();
    await listMediaSeriesEpisodes(repository, series.seriesKey, { pageSize: 40, anchorMediaKey: "video.madrid.01" }, ownerId);
    expect(repository.listEpisodes).toHaveBeenCalledExactlyOnceWith(series.seriesKey, { pageSize: 40, anchorMediaKey: "video.madrid.01" }, ownerId);
  });

  it("denies all writes by non-owners before validation and storage", async () => {
    const repository = makeRepository();
    await expect(saveMediaSeries(repository, series.seriesKey, command, otherId)).rejects.toBeInstanceOf(ContentWorkflowForbiddenError);
    delete process.env.CONTENT_WORKFLOW_OWNER_USER_IDS;
    await expect(saveMediaSeries(repository, series.seriesKey, command, ownerId)).rejects.toBeInstanceOf(ContentWorkflowForbiddenError);
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = "malformed-allowlist";
    await expect(saveMediaSeries(repository, series.seriesKey, command, ownerId)).rejects.toBeInstanceOf(ContentWorkflowForbiddenError);
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });

  it("fully validates commands and route keys before calling save", async () => {
    const repository = makeRepository();
    await expect(saveMediaSeries(repository, "../series", command, ownerId)).rejects.toMatchObject({ code: "MEDIA_SERIES_COMMAND_INVALID" });
    for (const invalid of [
      { ...command, expectedRevision: -1 },
      { ...command, userId: otherId },
      { ...command, members: [{ stableKey: "video.madrid.01", position: null, seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: command.evidence }] },
      { ...command, evidence: ["https://example.test/play?token=private"] },
    ]) {
      await expect(saveMediaSeries(repository, series.seriesKey, invalid, ownerId)).rejects.toMatchObject({ code: "MEDIA_SERIES_COMMAND_INVALID" });
    }
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("saves only parsed metadata with the authenticated owner", async () => {
    const repository = makeRepository();
    expect(await saveMediaSeries(repository, series.seriesKey, { ...command, title: " Madrid " }, ownerId)).toEqual(series);
    expect(repository.save).toHaveBeenCalledExactlyOnceWith(series.seriesKey, command, ownerId);
    expect(repository.getSeries).not.toHaveBeenCalled();
  });

  it("canonicalizes UUID casing for the same owner on the original write and its replay", async () => {
    const repository = makeRepository();
    const canonicalOwner = "00000000-0000-4000-8000-0000000000a1";
    process.env.CONTENT_WORKFLOW_OWNER_USER_IDS = canonicalOwner;
    expect(await saveMediaSeries(repository, series.seriesKey, command, canonicalOwner.toUpperCase())).toEqual(series);
    expect(await saveMediaSeries(repository, series.seriesKey, command, canonicalOwner)).toEqual(series);
    expect(repository.save.mock.calls.map((call) => call[2])).toEqual([canonicalOwner, canonicalOwner]);
  });

  it("keeps user-specific reads separate and preserves repository conflicts", async () => {
    const repository = makeRepository();
    await getMediaSeriesRecommendations(repository, "video.madrid.01", ownerId);
    await getMediaSeriesRecommendations(repository, "video.madrid.01", otherId);
    expect(repository.recommendations.mock.calls).toEqual([["video.madrid.01", ownerId], ["video.madrid.01", otherId]]);
    const conflict = new MediaSeriesError("MEDIA_SERIES_REVISION_CONFLICT");
    repository.save.mockRejectedValueOnce(conflict);
    await expect(saveMediaSeries(repository, series.seriesKey, command, ownerId)).rejects.toBe(conflict);
    expect(repository.save).toHaveBeenCalledTimes(1);
  });
});
