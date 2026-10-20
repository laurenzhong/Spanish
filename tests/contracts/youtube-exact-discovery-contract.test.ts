// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createYouTubeChannelAdapterFromSource, YouTubeChannelAdapter, youtubeRightsPolicySchema } from "@/src/modules/content-acquisition";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition/repositories";

const channelId = "UCabcdefghijklmnopqrstuv";
const ids = ["exactVideo1", "exactVideo2"];
const source: ContentSourceRecord = {
  id: "source-exact", stableKey: "youtube.exact", adapterType: "youtube", sourceKind: "video-channel",
  externalSourceId: channelId, displayName: "Test channel", language: "es", region: "es-ES",
  enabled: true, rightsStatus: "verified", cursor: null, revision: 1,
  rightsPolicy: { contentMode: "official_embed", license: "licensed", attribution: "Test attribution", licenseEvidence: "https://source.example.test/license", cefr: "A2", topics: ["topic.daily-life"], allowedRegions: ["ES"], allowedVideoIds: ids },
};
const request = { sourceStableKey: source.stableKey, externalSourceId: channelId, cursor: null, limit: 2 };
function detail(id: string) {
  return {
    id, snippet: { channelId, channelTitle: "Test channel", title: `Video ${id}`, description: "Test metadata", publishedAt: "2018-01-01T00:00:00Z", defaultAudioLanguage: "es" },
    contentDetails: { duration: "PT4M" }, status: { privacyStatus: "public", embeddable: true, license: "youtube" },
  };
}
function setup(items = ids.map(detail), selectedSource = source) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ items }), { headers: { "content-type": "application/json" } }));
  const adapter = createYouTubeChannelAdapterFromSource(selectedSource, fetchMock, "fake-server-key");
  return { fetchMock, adapter };
}

describe("exact YouTube metadata discovery", () => {
  it("queries only the configured old IDs through videos.list and emits candidates in configuration order", async () => {
    const { adapter, fetchMock } = setup(ids.map(detail).reverse());
    const page = await adapter.discover(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
    expect(url.searchParams.get("id")).toBe(ids.join(","));
    expect(page.items.map((item) => item.externalItemId)).toEqual(ids);
    expect(page.nextCursor).toBeNull();
    for (const item of page.items) {
      expect(item.metadata.videoDraft).toMatchObject({ sourceChannelId: channelId, captionStatus: "unavailable", segments: [] });
      expect(item.metadata).not.toHaveProperty("mediaProcessingReview");
    }
  });

  it("honors limit=1 across persisted cursor pages then resets for a later refresh", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (value) => {
      const id = new URL(String(value)).searchParams.get("id")!;
      return new Response(JSON.stringify({ items: id.split(",").map(detail) }), { headers: { "content-type": "application/json" } });
    });
    const adapter = createYouTubeChannelAdapterFromSource(source, fetchMock, "fake-key");
    const first = await adapter.discover({ ...request, limit: 1 });
    expect(first.items.map((item) => item.externalItemId)).toEqual([ids[0]]);
    expect(first.nextCursor).not.toBeNull();
    const second = await adapter.discover({ ...request, limit: 1, cursor: first.nextCursor });
    expect(second.items.map((item) => item.externalItemId)).toEqual([ids[1]]);
    expect(second.nextCursor).toBeNull();
    const refresh = await adapter.discover({ ...request, limit: 1, cursor: second.nextCursor });
    expect(refresh.items[0]?.externalItemId).toBe(ids[0]);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("id"))).toEqual([ids[0], ids[1], ids[0]]);
  });

  it.each([
    [], ["invalid"], [ids[0], ids[0]], [ids[0], ids[1], "otherVideo3"],
    ["https://www.youtube.com/watch?v=exactVideo1"], [" exactVideo1"], [ids[0], "ExactVideo1"], null,
  ].map((allowedVideoIds) => ({ allowedVideoIds })))("rejects an invalid exact-ID policy before requesting anything: %j", ({ allowedVideoIds }) => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(() => createYouTubeChannelAdapterFromSource({ ...source, rightsPolicy: { ...source.rightsPolicy, allowedVideoIds } }, fetchMock, "fake-key")).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps legacy policies valid when the exact-ID field is omitted", () => {
    const legacy = { ...source.rightsPolicy };
    delete legacy.allowedVideoIds;
    expect(youtubeRightsPolicySchema.parse(legacy)).not.toHaveProperty("allowedVideoIds");
  });

  it.each(["extra", "duplicate"])("rejects %s response IDs instead of importing an unrelated or repeated item", async (mode) => {
    const items = ids.map(detail);
    items.push(detail(mode === "extra" ? "otherVideo3" : ids[0]));
    const { adapter } = setup(items);
    await expect(adapter.discover(request)).rejects.toMatchObject({ code: "CONTENT_PROCESSING_FAILED" });
  });

  it("does not substitute a feed item when requested metadata is missing", async () => {
    const { adapter, fetchMock } = setup([]);
    const page = await adapter.discover(request);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["channel", "private", "embed", "language", "duration", "region", "title", "license"])("retains the %s gate for exact metadata", async (gate) => {
    const item = detail(ids[0]);
    if (gate === "channel") item.snippet.channelId = "UCzyxwvutsrqponmlkjihgfe";
    if (gate === "private") item.status.privacyStatus = "private";
    if (gate === "embed") item.status.embeddable = false;
    if (gate === "language") item.snippet.defaultAudioLanguage = "en";
    if (gate === "duration") item.contentDetails.duration = "PT2H";
    if (gate === "region") Object.assign(item.contentDetails, { regionRestriction: { blocked: ["ES"] } });
    if (gate === "title") item.snippet.title = " ";
    const selected = gate === "license" ? { ...source, rightsPolicy: { ...source.rightsPolicy, license: "creative_commons" } } : source;
    const { adapter } = setup([item], selected);
    expect((await adapter.discover(request)).items).toEqual([]);
  });

  it("rejects a cursor from another ordered ID configuration before network", async () => {
    const original = setup();
    // A one-item first page must only request that first item.
    original.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [detail(ids[0])] }), { headers: { "content-type": "application/json" } }));
    const first = await original.adapter.discover({ ...request, limit: 1 });
    const changed = setup(ids.map(detail), { ...source, rightsPolicy: { ...source.rightsPolicy, allowedVideoIds: [...ids].reverse() } });
    await expect(changed.adapter.discover({ ...request, cursor: first.nextCursor })).rejects.toThrow(/cursor/i);
    expect(changed.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects feed or malformed cursors before network", async () => {
    for (const cursor of ["not-json", JSON.stringify({ latestPublishedAt: "2026-10-16T00:00:00Z", latestVideoId: ids[0] })]) {
      const { adapter, fetchMock } = setup();
      await expect(adapter.discover({ ...request, cursor })).rejects.toThrow(/cursor/i);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it.each([
    { version: 2 }, { offset: -1 }, { offset: 2 }, { offset: 0.5 },
    { mode: "channel-feed" }, { sourceStableKey: "youtube.other" },
    { channelId: "UCzyxwvutsrqponmlkjihgfe" }, { extra: "unexpected" },
  ])("rejects invalid cursor scope or position: %j", async (change) => {
    const { adapter, fetchMock } = setup();
    const cursor = JSON.stringify({ mode: "exact-video-ids", version: 1, sourceStableKey: source.stableKey, channelId, videoIds: ids, offset: 1, ...change });
    await expect(adapter.discover({ ...request, cursor })).rejects.toThrow(/cursor/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("advances past omitted metadata and retries it in a later pass", async () => {
    const { adapter, fetchMock } = setup([]);
    const first = await adapter.discover({ ...request, limit: 1 });
    expect(first.items).toEqual([]);
    expect(first.nextCursor).not.toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [detail(ids[1])] }), { headers: { "content-type": "application/json" } }));
    const second = await adapter.discover({ ...request, limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.externalItemId).toBe(ids[1]);
    expect(second.nextCursor).toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ items: [detail(ids[0])] }), { headers: { "content-type": "application/json" } }));
    expect((await adapter.discover({ ...request, limit: 1 })).items[0]?.externalItemId).toBe(ids[0]);
  });

  it("rejects another allowed ID if it was not requested in the current page", async () => {
    const { adapter } = setup([detail(ids[1])]);
    await expect(adapter.discover({ ...request, limit: 1 })).rejects.toThrow(/unexpected/i);
  });

  it("does not interpret video IDs case-insensitively", async () => {
    const { adapter } = setup([detail("ExactVideo1")]);
    await expect(adapter.discover(request)).rejects.toThrow(/unexpected/i);
  });

  it("rejects an exact-mode marker in the legacy feed cursor", async () => {
    const legacy = { ...source.rightsPolicy }; delete legacy.allowedVideoIds;
    const { adapter, fetchMock } = setup([], { ...source, rightsPolicy: legacy });
    const cursor = JSON.stringify({ mode: "exact-video-ids", latestVideoId: ids[0], latestPublishedAt: "2026-01-01T00:00:00Z" });
    await expect(adapter.discover({ ...request, cursor })).rejects.toThrow(/cursor/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never follows a redirect from the credential-bearing API endpoint", async () => {
    const { adapter, fetchMock } = setup();
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://www.googleapis.com/other" } }));
    await expect(adapter.discover(request)).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps network errors retryable without exposing the server key", async () => {
    const { adapter, fetchMock } = setup();
    fetchMock.mockImplementation(async () => { throw new Error("https://www.googleapis.com/?key=fake-server-key"); });
    await expect(adapter.discover(request)).rejects.toMatchObject({ retryable: true, message: "CONTENT_PROCESSING_FAILED: Source request failed." });
  });

  it("rejects an oversized metadata response without fetching another resource", async () => {
    const item = detail(ids[0]); item.snippet.description = "x".repeat(2000);
    const { adapter, fetchMock } = setup([item], { ...source, rightsPolicy: { ...source.rightsPolicy, maxApiBytes: 1024 } });
    await expect(adapter.discover(request)).rejects.toThrow(/size limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an already cancelled discovery without a request", async () => {
    const { adapter, fetchMock } = setup(); const controller = new AbortController(); controller.abort();
    await expect(adapter.discover(request, { signal: controller.signal })).rejects.toThrow(/cancel/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not accept success after a cancelled fetch ignores abort", async () => {
    const { adapter, fetchMock } = setup(); const controller = new AbortController();
    fetchMock.mockImplementation(async () => { controller.abort(); return new Response(JSON.stringify({ items: ids.map(detail) }), { headers: { "content-type": "application/json" } }); });
    await expect(adapter.discover(request, { signal: controller.signal })).rejects.toThrow(/cancel/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates direct-constructor allowlists rather than silently falling back to the channel feed", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const config = { channelId, channelName: "Test", region: "es-ES", cefr: "A2" as const, topics: ["topic.daily-life"], license: "licensed" as const, attribution: "Test", licenseEvidence: "https://source.example.test/license", allowedVideoIds: [] };
    const adapter = new YouTubeChannelAdapter({ fetch: fetchMock, apiKey: "fake-key", source: config });
    await expect(adapter.discover(request)).rejects.toMatchObject({ code: "CONTENT_PROCESSING_FAILED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
