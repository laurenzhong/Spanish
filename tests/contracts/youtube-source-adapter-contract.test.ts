// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { YouTubeChannelAdapter } from "@/src/modules/content-acquisition";

async function fixture(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "tests", "fixtures", "content-acquisition", "youtube", name), "utf8");
}

describe("YouTube source adapter contract", () => {
  it("discovers only public embeddable channel videos and advances a stable cursor", async () => {
    const feed = await fixture("channel-feed.xml");
    const details = await fixture("video-details.json");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("feeds/videos.xml")) {
        return new Response(feed, {
          headers: { "content-type": "application/atom+xml", etag: '"feed-v1"' },
        });
      }
      if (url.includes("youtube/v3/videos")) {
        return new Response(details, { headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const adapter = new YouTubeChannelAdapter({
      fetch: fetchMock,
      apiKey: "fixture-key",
      source: {
        channelId: "UCabcdefghijklmnopqrstuv",
        channelName: "Español con calma",
        region: "es-ES",
        cefr: "A2",
        topics: ["topic.daily-life"],
        license: "licensed",
        attribution: "Español con calma en YouTube",
        licenseEvidence: "https://www.youtube.com/t/terms",
      },
      now: () => new Date("2026-09-13T10:00:00.000Z"),
    });

    const page = await adapter.discover({
      sourceStableKey: "youtube.espanol-con-calma",
      externalSourceId: "UCabcdefghijklmnopqrstuv",
      cursor: null,
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      externalItemId: "publicVideo1",
      canonicalUrl: "https://www.youtube.com/watch?v=publicVideo1",
      contentType: "video",
      language: "es",
      metadata: {
        videoDraft: {
          stableKey: "youtube.publicvideo1",
          embedUrl: "https://www.youtube-nocookie.com/embed/publicVideo1?enablejsapi=1",
          durationMs: 245_000,
          captionStatus: "unavailable",
        },
      },
    });
    expect(JSON.parse(page.nextCursor!)).toMatchObject({
      latestPublishedAt: "2026-09-13T08:00:00.000Z",
      latestVideoId: "publicVideo1",
      etag: '"feed-v1"',
    });
  });

  it("uses conditional feed validators and treats 304 as an empty incremental page", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"feed-v1"');
      return new Response(null, { status: 304 });
    });
    const cursor = JSON.stringify({
      latestPublishedAt: "2026-09-13T08:00:00.000Z",
      latestVideoId: "publicVideo1",
      etag: '"feed-v1"',
    });
    const adapter = new YouTubeChannelAdapter({
      fetch: fetchMock,
      apiKey: "fixture-key",
      source: {
        channelId: "UCabcdefghijklmnopqrstuv",
        channelName: "Español con calma",
        region: "es-ES",
        cefr: "A2",
        topics: ["topic.daily-life"],
        license: "licensed",
        attribution: "Español con calma en YouTube",
        licenseEvidence: "https://www.youtube.com/t/terms",
      },
    });

    await expect(adapter.discover({
      sourceStableKey: "youtube.espanol-con-calma",
      externalSourceId: "UCabcdefghijklmnopqrstuv",
      cursor,
      limit: 20,
    })).resolves.toEqual({
      sourceStableKey: "youtube.espanol-con-calma",
      cursor,
      nextCursor: cursor,
      estimatedCostMicros: 0,
      items: [],
    });
  });

  it("fails closed for a non-Spanish declaration or a non-CC video under a Creative Commons source policy", async () => {
    const feed = await fixture("channel-feed.xml");
    const original = JSON.parse(await fixture("video-details.json")) as { items: Array<{ snippet: { defaultAudioLanguage?: string }; status: { license?: string } }> };
    for (const change of [
      (details: typeof original) => { details.items[0]!.snippet.defaultAudioLanguage = "en"; },
      (details: typeof original) => { details.items[0]!.status.license = "youtube"; },
    ]) {
      const details = structuredClone(original);
      details.items[0]!.status.license = "creativeCommon";
      change(details);
      const fetchMock = vi.fn<typeof fetch>(async (input) => new Response(
        String(input).includes("feeds/videos.xml") ? feed : JSON.stringify(details),
        { headers: { "content-type": String(input).includes("feeds/videos.xml") ? "application/atom+xml" : "application/json" } },
      ));
      const adapter = new YouTubeChannelAdapter({
        fetch: fetchMock,
        apiKey: "fixture-key",
        source: {
          channelId: "UCabcdefghijklmnopqrstuv", channelName: "Español con calma", region: "es-ES", cefr: "A2",
          topics: ["topic.daily-life"], license: "creative_commons", attribution: "Canal de prueba", licenseEvidence: "https://example.com/license",
        },
      });
      const page = await adapter.discover({ sourceStableKey: "youtube.test", externalSourceId: "UCabcdefghijklmnopqrstuv", cursor: null, limit: 20 });
      expect(page.items).toEqual([]);
    }
  });
});
