import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptsPodcastAudioContentType,
  officialPodcastFeedFor,
  resolveOfficialPodcastSource,
} from "@/src/modules/media/storage/podcast-source-resolver";

const allowedHosts = new Set(["content.libsyn.com", "traffic.libsyn.com", "charlashispanas.com", "www.hoyhablamos.com"]);
const options = { isAllowedSourceHost: (hostname: string) => allowedHosts.has(hostname.trim().toLowerCase()) };

const feed = (items: readonly string[]) => `<rss><channel>${items.join("")}</channel></rss>`;
const item = (title: string, url: string) => `<item><title>${title}</title><enclosure url="${url}" /></item>`;

function stubFeed(xml: string, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(xml, { status, headers: { "content-type": "application/rss+xml" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

const broadAllowedHosts = new Set([
  "content.libsyn.com",
  "media.blubrry.com",
  "content.blubrry.com",
  "traffic.libsyn.com",
  "charlashispanas.com",
  "www.hoyhablamos.com",
  "dts.podtrac.com",
  "ztnr.rtve.es",
  "feeds.simplecast.com",
]);

function fakeFeed(xml: string) {
  const fetcher = vi.fn(async () => new Response(xml, { status: 200, headers: { "content-type": "application/rss+xml" } }));
  return { fetcher, isAllowedSourceHost: (hostname: string) => broadAllowedHosts.has(hostname) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("official podcast source resolver", () => {
  it("resolves the episode whose title matches, even when the file was renamed", async () => {
    stubFeed(feed([
      item("Otro episodio", "https://content.libsyn.com/another-file.mp3"),
      item("148: Right in Spanish: Correcto, derecha, derecho", "https://content.libsyn.com/fresh.mp3"),
    ]));

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "148: Right in Spanish: Correcto, derecha, derecho",
      currentUrl: "https://content.libsyn.com/stale.mp3",
    }, options);

    expect(resolved?.toString()).toBe("https://content.libsyn.com/fresh.mp3");
  });

  it("falls back to the file name only when no title matches", async () => {
    stubFeed(feed([item("Un título distinto", "https://content.libsyn.com/episode-42.mp3")]));

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "Título que no aparece",
      currentUrl: "https://content.libsyn.com/episode-42.mp3",
    }, options);

    expect(resolved?.toString()).toBe("https://content.libsyn.com/episode-42.mp3");
  });

  it("returns null for a publisher outside the allowlist without fetching anything", async () => {
    const fetcher = stubFeed(feed([item("Cualquiera", "https://content.libsyn.com/a.mp3")]));

    await expect(resolveOfficialPodcastSource({
      sourceName: "Unknown Publisher",
      title: "Cualquiera",
      currentUrl: "https://content.libsyn.com/a.mp3",
    }, options)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when the feed cannot be read", async () => {
    stubFeed("", 503);

    await expect(resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "148: Right in Spanish",
      currentUrl: "https://content.libsyn.com/stale.mp3",
    }, options)).resolves.toBeNull();
  });

  it("never returns a candidate the caller's host predicate rejects", async () => {
    stubFeed(feed([item("148: Right in Spanish", "https://evil.example.test/fresh.mp3")]));

    await expect(resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "148: Right in Spanish",
      currentUrl: "https://content.libsyn.com/stale.mp3",
    }, options)).resolves.toBeNull();
  });

  it("never returns a candidate that is not https or carries credentials", async () => {
    stubFeed(feed([
      item("148: Right in Spanish", "http://content.libsyn.com/plain.mp3"),
      item("148: Right in Spanish", "https://user:pass@content.libsyn.com/secret.mp3"),
    ]));

    await expect(resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "148: Right in Spanish",
      currentUrl: "https://content.libsyn.com/stale.mp3",
    }, options)).resolves.toBeNull();
  });

  it("routes Blubrry-hosted shows through the publisher's own player endpoint", async () => {
    stubFeed(feed([item("Episodio 12", "https://media.blubrry.com/show/episode-12.mp3")]));

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "Hoy Hablamos",
      title: "Episodio 12",
      currentUrl: "https://www.hoyhablamos.com/episode-12.mp3",
    }, { isAllowedSourceHost: (hostname) => hostname === "media.blubrry.com" || hostname === "www.hoyhablamos.com" });

    expect(resolved?.hostname).toBe("www.hoyhablamos.com");
    expect(resolved?.searchParams.get("file")).toBe("https://media.blubrry.com/show/episode-12.mp3");
  });

  it("maps a matching Blubrry enclosure to the publisher download proxy", async () => {
    const { fetcher, isAllowedSourceHost } = fakeFeed(`<?xml version="1.0"?><rss><channel><item>
      <title>1751. Expresiones en español</title>
      <enclosure url="https://media.blubrry.com/charlashispanas/content.blubrry.com/charlashispanas/Episodio_1751_Expresiones_mezcla.mp3" type="audio/mpeg" />
    </item></channel></rss>`);

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "Charlas Hispanas: Aprende Español | Learn Spanish",
      title: "1751. Expresiones en español",
      currentUrl: "https://content.blubrry.com/charlashispanas/Episodio_1751_Expresiones_mezcla.mp3",
    }, { fetcher, isAllowedSourceHost });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(resolved?.hostname).toBe("charlashispanas.com");
    expect(resolved?.pathname).toContain("downloadaudio.php");
    expect(resolved?.searchParams.get("file")).toContain("media.blubrry.com/charlashispanas");
  });

  it("selects a fresh LearnCraft Libsyn enclosure by filename", async () => {
    const { fetcher, isAllowedSourceHost } = fakeFeed(`<rss><channel><item>
      <title>148: Right in Spanish: Correcto, derecha, derecho</title>
      <enclosure url="https://content.libsyn.com/p/b/0/f/b0fa269d7eec30b2/1787333301327_148_148__Right_in_Spanish__Correcto_derecha_derecho.mp3?dest-id=3943362" />
    </item></channel></rss>`);

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "LearnCraft Spanish",
      title: "148: Right in Spanish: Correcto, derecha, derecho",
      currentUrl: "https://content.libsyn.com/p/b/0/f/b0fa269d7eec30b2/1787333301327_148_148__Right_in_Spanish__Correcto_derecha_derecho.mp3?expired=1",
    }, { fetcher, isAllowedSourceHost });

    expect(resolved?.hostname).toBe("content.libsyn.com");
    expect(resolved?.searchParams.get("dest-id")).toBe("3943362");
  });

  it("selects a fresh News in Slow Spanish Latino enclosure by episode filename", async () => {
    const { fetcher, isAllowedSourceHost } = fakeFeed(`<rss><channel><item>
      <title>News in Slow Spanish Latino #695 - Spanish Intermediate Weekly Program</title>
      <enclosure url="https://traffic.libsyn.com/secure/nsslatino/nssl695-itunes.mp3?dest-id=146316" />
    </item></channel></rss>`);

    const resolved = await resolveOfficialPodcastSource({
      sourceName: "News in Slow Spanish Latino (Intermediate)",
      title: "Noticias en español Latino #695: actualidad, gramática y cultura",
      currentUrl: "https://content.libsyn.com/p/8/a/4/8a4f5ef4b334921e/nssl695-itunes.mp3?expired=1",
    }, { fetcher, isAllowedSourceHost });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(resolved?.hostname).toBe("traffic.libsyn.com");
    expect(resolved?.pathname).toBe("/secure/nsslatino/nssl695-itunes.mp3");
    expect(resolved?.searchParams.get("dest-id")).toBe("146316");
  });

  it("fails closed for unknown publishers and unallowlisted enclosures", async () => {
    const unknown = vi.fn(async () => new Response("<rss />", { status: 200 }));
    await expect(resolveOfficialPodcastSource({ sourceName: "Unknown", title: "Episode", currentUrl: "https://example.com/a.mp3" }, { fetcher: unknown })).resolves.toBeNull();
    expect(unknown).not.toHaveBeenCalled();

    const { fetcher, isAllowedSourceHost } = fakeFeed(`<rss><channel><item>
      <title>1751. Expresiones en español</title>
      <enclosure url="https://evil.example/audio.mp3" />
    </item></channel></rss>`);
    await expect(resolveOfficialPodcastSource({
      sourceName: "Charlas Hispanas",
      title: "1751. Expresiones en español",
      currentUrl: "https://content.blubrry.com/charlashispanas/Episodio_1751.mp3",
    }, { fetcher, isAllowedSourceHost })).resolves.toBeNull();
  });

  it("exposes only the hard-coded official feed catalogue", () => {
    expect(officialPodcastFeedFor("Hoy Hablamos: Podcast diario")).toBe("https://www.hoyhablamos.com/category/podcast/feed/");
    expect(officialPodcastFeedFor("News in Slow Spanish Latino (Intermediate)")).toBe("https://rss.libsyn.com/shows/45040/destinations/146316.xml");
    expect(officialPodcastFeedFor("arbitrary.example")).toBeNull();
  });
});

describe("podcast audio content types", () => {
  it("accepts audio types from any host", () => {
    expect(acceptsPodcastAudioContentType("audio.example.test", "audio/mpeg")).toBe(true);
    expect(acceptsPodcastAudioContentType("audio.example.test", "audio/mpeg; charset=utf-8")).toBe(true);
  });

  it("accepts a generic binary stream only from verified hosts", () => {
    expect(acceptsPodcastAudioContentType("content.libsyn.com", "application/octet-stream")).toBe(true);
    expect(acceptsPodcastAudioContentType("audio.example.test", "application/octet-stream")).toBe(false);
  });

  it("accepts generic binary streams from the publisher download proxies and verified media hosts", () => {
    expect(acceptsPodcastAudioContentType("www.hoyhablamos.com", "application/octet-stream")).toBe(true);
    expect(acceptsPodcastAudioContentType("charlashispanas.com", "application/octet-stream; charset=binary")).toBe(true);
    // Verified media hosts stay trusted for generic binary streams: the media
    // backfills download from libsyn/Blubrry CDNs that answer octet-stream.
    expect(acceptsPodcastAudioContentType("content.blubrry.com", "application/octet-stream")).toBe(true);
    expect(acceptsPodcastAudioContentType("www.hoyhablamos.com", "text/html")).toBe(false);
    expect(acceptsPodcastAudioContentType("content.blubrry.com", "audio/mpeg; charset=utf-8")).toBe(true);
  });

  it("rejects non-audio types and empty values", () => {
    expect(acceptsPodcastAudioContentType("content.libsyn.com", "text/html")).toBe(false);
    expect(acceptsPodcastAudioContentType("content.libsyn.com", "")).toBe(false);
  });
});
