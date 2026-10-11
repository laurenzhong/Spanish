import { afterEach, describe, expect, it, vi } from "vitest";

import { acceptsPodcastAudioContentType, resolveOfficialPodcastSource } from "@/src/modules/media/storage/podcast-source-resolver";

const allowedHosts = new Set(["content.libsyn.com", "traffic.libsyn.com", "charlashispanas.com", "www.hoyhablamos.com"]);
const options = { isAllowedSourceHost: (hostname: string) => allowedHosts.has(hostname.trim().toLowerCase()) };

const feed = (items: readonly string[]) => `<rss><channel>${items.join("")}</channel></rss>`;
const item = (title: string, url: string) => `<item><title>${title}</title><enclosure url="${url}" /></item>`;

function stubFeed(xml: string, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(new Response(xml, { status, headers: { "content-type": "application/rss+xml" } }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
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
    }, { isAllowedSourceHost: (hostname) => hostname === "media.blubrry.com" });

    expect(resolved?.hostname).toBe("www.hoyhablamos.com");
    expect(resolved?.searchParams.get("file")).toBe("https://media.blubrry.com/show/episode-12.mp3");
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

  it("rejects non-audio types and empty values", () => {
    expect(acceptsPodcastAudioContentType("content.libsyn.com", "text/html")).toBe(false);
    expect(acceptsPodcastAudioContentType("content.libsyn.com", "")).toBe(false);
  });
});
