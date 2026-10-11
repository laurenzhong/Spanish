import { isAllowedMediaSourceHost } from "./media-source-hosts";

/**
 * Publisher fallbacks for podcast audio whose stored URL no longer serves the
 * file. The mapping is deliberately a small, named allowlist: a resolver must
 * never turn an arbitrary URL into a download target, and every address here was
 * verified against the publisher's own feed during the media backfills.
 */
const publisherFeeds = [
  { source: "Charlas Hispanas", feedUrl: "https://charlashispanas.com/feed/podcast/" },
  { source: "Hoy Hablamos", feedUrl: "https://www.hoyhablamos.com/category/podcast/feed/" },
  { source: "LearnCraft Spanish", feedUrl: "https://rss.libsyn.com/shows/466488/destinations/3943362.xml" },
] as const;

/** Publishers whose own player endpoint must serve audio we already verified. */
const publisherProxyHosts = [
  { source: "Charlas Hispanas", host: "https://charlashispanas.com" },
  { source: "Hoy Hablamos", host: "https://www.hoyhablamos.com" },
] as const;

const blubrryHosts = new Set(["media.blubrry.com", "content.blubrry.com"]);
const genericAudioContentTypes = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/x-m4a"]);
/** Some publishers serve podcast audio as a generic binary stream. */
const streamsWithoutAudioContentType = new Set(["application/octet-stream", "binary/octet-stream"]);

type FeedEpisode = Readonly<{ title: string; enclosureUrl: string }>;

function episodeSlug(value: string): string {
  try {
    const path = decodeURIComponent(new URL(value).pathname);
    return path.split("/").pop()?.replace(/\.[^.]+$/u, "").toLowerCase() ?? "";
  } catch {
    return "";
  }
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLowerCase();
}

function feedUrlFor(sourceName: string): string | null {
  return publisherFeeds.find((entry) => sourceName.includes(entry.source))?.feedUrl ?? null;
}

function feedEpisodes(xml: string): readonly FeedEpisode[] {
  return (xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/giu) ?? []).flatMap((item) => {
    const enclosureUrl = /<enclosure\b[^>]*?\burl=["']([^"']+)/iu.exec(item)?.[1];
    if (!enclosureUrl) return [];
    const rawTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(item)?.[1] ?? "";
    const title = rawTitle
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
      .replace(/<[^>]*>/gu, "")
      .trim();
    return [{ title, enclosureUrl }];
  });
}

/**
 * True when a publisher may serve podcast audio under this content type. Generic
 * binary streams are only trusted for hosts whose own feeds were verified;
 * anywhere else the caller keeps the stricter audio-only expectation.
 */
export function acceptsPodcastAudioContentType(hostname: string, contentType: string): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!normalized) return false;
  if (genericAudioContentTypes.has(normalized)) return true;
  if (!streamsWithoutAudioContentType.has(normalized)) return false;
  return isAllowedMediaSourceHost(hostname);
}

/**
 * Resolves an official publisher URL for a podcast whose stored address stopped
 * serving. Returns `null` whenever the publisher is unknown, the feed cannot be
 * read, or nothing in it matches; the caller then keeps the verified stored
 * asset and fails closed. Every returned URL has already passed the caller's
 * host predicate.
 */
export async function resolveOfficialPodcastSource(
  input: Readonly<{ sourceName: string; title: string; currentUrl: string }>,
  options: Readonly<{ isAllowedSourceHost: (hostname: string) => boolean }>,
): Promise<URL | null> {
  const feedUrl = feedUrlFor(input.sourceName);
  if (!feedUrl) return null;

  let xml: string;
  try {
    // Pass a URL instance: every fetch call in this path keeps its target as a
    // parsed URL so the allowlist check and the request cannot diverge.
    const response = await fetch(new URL(feedUrl), { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    xml = await response.text();
  } catch {
    return null;
  }

  const wantedTitle = normalizeTitle(input.title);
  const wantedSlug = episodeSlug(input.currentUrl);
  const proxyHost = publisherProxyHosts.find((entry) => input.sourceName.includes(entry.source))?.host ?? null;
  let slugFallback: URL | null = null;

  for (const episode of feedEpisodes(xml)) {
    let candidate: URL;
    try {
      candidate = new URL(episode.enclosureUrl);
    } catch {
      continue;
    }
    if (candidate.protocol !== "https:" || candidate.username || candidate.password) continue;
    if (!options.isAllowedSourceHost(candidate.hostname)) continue;

    // The publisher's own player endpoint is the only way to read Blubrry-hosted
    // shows; the file parameter always carries the enclosure we just verified.
    const resolved = proxyHost && blubrryHosts.has(candidate.hostname) ? proxyThroughPublisher(proxyHost, candidate) : candidate;
    if (!resolved) continue;

    // Titles are authoritative because publishers rename audio files
    // independently of the episode title; the file name is only a fallback.
    if (wantedTitle.length > 0 && normalizeTitle(episode.title) === wantedTitle) return resolved;
    const slug = episodeSlug(episode.enclosureUrl);
    if (slug && wantedSlug && (slug === wantedSlug || slug.includes(wantedSlug) || wantedSlug.includes(slug))) slugFallback ??= resolved;
  }

  return slugFallback;
}

function proxyThroughPublisher(host: string, enclosure: URL): URL | null {
  try {
    const proxy = new URL(`${host}/wp-content/plugins/simple-podcast-press/responsive_audio_player/downloadaudio.php`);
    proxy.searchParams.set("file", enclosure.toString());
    return proxy;
  } catch {
    return null;
  }
}
