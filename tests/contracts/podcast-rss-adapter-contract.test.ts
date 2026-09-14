// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PodcastRssAdapter } from "@/src/modules/content-acquisition";

async function fixture(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "tests", "fixtures", "content-acquisition", "podcast", name), "utf8");
}

function adapter(fetchImpl: typeof fetch) {
  return new PodcastRssAdapter({
    fetch: fetchImpl,
    source: {
      feedUrl: "https://podcast.example.test/feed.xml",
      programName: "Café de cada día",
      region: "es-ES",
      cefr: "A2",
      topics: ["topic.daily-life"],
      license: "licensed",
      attribution: "Café de cada día",
      licenseEvidence: "https://podcast.example.test/license",
      allowedFeedHosts: ["podcast.example.test"],
      allowedArtworkHosts: ["images.example.test"],
      allowedEpisodeHosts: ["podcast.example.test"],
      allowedAudioHosts: ["media.example.test"],
      allowedTranscriptHosts: ["transcripts.example.test"],
      maxEnclosureBytes: 1_000,
      transcriptSourceKind: "platform_manual",
      playbackValidityHours: 168,
    },
    now: () => new Date("2026-09-14T10:00:00.000Z"),
  });
}

describe("podcast RSS adapter contract", () => {
  it("discovers a GUID once, validates its enclosure, and imports a legal WebVTT transcript", async () => {
    const feed = await fixture("feed-with-transcript.xml");
    const transcript = await fixture("episode-42.vtt");
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/feed.xml")) {
        return new Response(feed, { headers: { "content-type": "application/rss+xml", etag: '"podcast-v1"' } });
      }
      if (url.endsWith("episode-42.mp3")) {
        expect(init?.method).toBe("HEAD");
        return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "128" } });
      }
      if (url.endsWith("episode-42.vtt")) {
        return new Response(transcript, { headers: { "content-type": "text/vtt" } });
      }
      throw new Error(`unexpected URL: ${url}`);
    });

    const page = await adapter(fetchMock).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      externalItemId: "episode-42",
      canonicalUrl: "https://podcast.example.test/episodes/42",
      contentType: "podcast",
      language: "es",
      metadata: {
        podcastDraft: {
          episodeGuid: "episode-42",
          enclosureMimeType: "audio/mpeg",
          enclosureByteSize: 128,
          transcriptStatus: "platform_manual",
          artwork: { url: "https://images.example.test/cafe.jpg", source: "podcast-feed", width: null, height: null },
          segments: expect.arrayContaining([expect.objectContaining({ index: 0, sourceText: "Buenos días, ¿qué te pongo?" })]),
        },
      },
    });
    expect(JSON.parse(page.nextCursor!)).toMatchObject({
      latestPublishedAt: "2026-09-13T08:00:00.000Z",
      latestEpisodeGuid: "episode-42",
      etag: '"podcast-v1"',
    });
  });

  it("uses validators for incremental discovery and treats 304 as unchanged", async () => {
    const cursor = JSON.stringify({
      latestPublishedAt: "2026-09-13T08:00:00.000Z",
      latestEpisodeGuid: "episode-42",
      etag: '"podcast-v1"',
    });
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"podcast-v1"');
      return new Response(null, { status: 304 });
    });

    await expect(adapter(fetchMock).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor,
      limit: 20,
    })).resolves.toEqual({
      sourceStableKey: "podcast.cafe-diario",
      cursor,
      nextCursor: cursor,
      estimatedCostMicros: 0,
      items: [],
    });
  });

  it("deduplicates both repeated GUIDs and normalized episode URLs before enclosure requests", async () => {
    const feed = await fixture("feed-duplicates.xml");
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith("feed.xml")
      ? new Response(feed, { headers: { "content-type": "application/rss+xml" } })
      : new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "96" } }));

    const page = await adapter(fetchMock).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      externalItemId: "episode-a",
      canonicalUrl: "https://podcast.example.test/episodes/shared",
    });
    expect(fetchMock.mock.calls.filter(([input]) => !String(input).endsWith("feed.xml"))).toHaveLength(1);
  });

  it("publishes playback-only metadata when no legal transcript is declared", async () => {
    const feed = await fixture("feed-without-transcript.xml");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return url.endsWith("feed.xml")
        ? new Response(feed, { headers: { "content-type": "application/rss+xml" } })
        : new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "96" } });
    });

    const page = await adapter(fetchMock).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    });

    expect(page.items[0]?.metadata).toMatchObject({ podcastDraft: { transcriptStatus: "unavailable", segments: [] } });
    expect(page.items[0]?.metadata).toMatchObject({ podcastDraft: { artwork: null } });
  });

  it("drops artwork when the feed points to a host outside the artwork allowlist", async () => {
    const feed = (await fixture("feed-with-transcript.xml")).replace("images.example.test", "untrusted.example.test");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("feed.xml")) return new Response(feed, { headers: { "content-type": "application/rss+xml" } });
      if (url.endsWith(".mp3")) return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "128" } });
      return new Response("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHola", { headers: { "content-type": "text/vtt" } });
    });
    const page = await adapter(fetchMock).discover({ sourceStableKey: "podcast.cafe-diario", externalSourceId: "https://podcast.example.test/feed.xml", cursor: null, limit: 20 });
    expect(page.items[0]?.metadata).toMatchObject({ podcastDraft: { artwork: null } });
  });

  it("falls back to playback-only metadata when a declared transcript is invalid", async () => {
    const feed = await fixture("feed-with-transcript.xml");
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("feed.xml")) return new Response(feed, { headers: { "content-type": "application/rss+xml" } });
      if (url.endsWith(".mp3")) return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "128" } });
      return new Response("not WebVTT", { headers: { "content-type": "text/vtt" } });
    });

    const page = await adapter(fetchMock).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    });

    expect(page.items[0]?.metadata).toMatchObject({
      podcastDraft: { transcriptStatus: "unavailable", transcriptUrl: null, segments: [] },
    });
  });

  it("fails the run on transient enclosure or transcript errors so the source cursor can be retried", async () => {
    const withoutTranscript = await fixture("feed-without-transcript.xml");
    const enclosureFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("feed.xml")) {
        return new Response(withoutTranscript, { headers: { "content-type": "application/rss+xml" } });
      }
      throw new Error("secret media URL https://media.example.test/audio/episode-43.mp3?token=do-not-log");
    });
    const enclosurePromise = adapter(enclosureFetch).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    });
    await expect(enclosurePromise).rejects.toMatchObject({ retryable: true });
    await expect(enclosurePromise).rejects.not.toThrow(/do-not-log|episode-43\.mp3/iu);

    const withTranscript = await fixture("feed-with-transcript.xml");
    const transcriptFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("feed.xml")) return new Response(withTranscript, { headers: { "content-type": "application/rss+xml" } });
      if (url.endsWith(".mp3")) return new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "128" } });
      return new Response(null, { status: 503 });
    });
    await expect(adapter(transcriptFetch).discover({
      sourceStableKey: "podcast.cafe-diario",
      externalSourceId: "https://podcast.example.test/feed.xml",
      cursor: null,
      limit: 20,
    })).rejects.toMatchObject({ retryable: true });
  });

  it("fails closed for non-audio, oversized, or off-allowlist redirected enclosures", async () => {
    const feed = await fixture("feed-without-transcript.xml");
    for (const enclosureResponse of [
      new Response(null, { headers: { "content-type": "text/html", "content-length": "96" } }),
      new Response(null, { headers: { "content-type": "audio/mpeg", "content-length": "1001" } }),
      new Response(null, { status: 302, headers: { location: "https://evil.example/audio.mp3" } }),
      new Response(null, { status: 404 }),
    ]) {
      const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith("feed.xml")
        ? new Response(feed, { headers: { "content-type": "application/rss+xml" } })
        : enclosureResponse.clone());
      const page = await adapter(fetchMock).discover({
        sourceStableKey: "podcast.cafe-diario",
        externalSourceId: "https://podcast.example.test/feed.xml",
        cursor: null,
        limit: 20,
      });
      expect(page.items).toEqual([]);
    }
  });
});
