/**
 * Resolve a fresh, publisher-controlled podcast enclosure before using the
 * URL stored by Language Reactor.  The stored URLs may be signed CDN links
 * that expire; this resolver only uses a small, hard-coded catalogue of the
 * publishers' public RSS feeds.  It never follows an arbitrary feed URL.
 */

export type OfficialPodcastSourceInput = Readonly<{
  sourceName: string;
  title: string;
  currentUrl: string;
}>;

export type OfficialPodcastSourceResolverOptions = Readonly<{
  fetcher?: typeof fetch;
  isAllowedSourceHost?: (hostname: string) => boolean;
}>;

type FeedDefinition = Readonly<{
  sourceNamePattern: RegExp;
  feedUrl: string;
  proxyHost?: string;
}>;

/**
 * The two publisher download endpoints below intentionally return
 * `application/octet-stream` even though the payload is an MP3.  They are
 * fixed, publisher-controlled URLs produced by the feed resolver; accepting
 * that MIME on arbitrary hosts would make a corrupt or non-audio response
 * indistinguishable from a valid enclosure.  The migration still validates
 * the bytes with ffmpeg and the decoded duration before publishing them.
 */
export const officialPodcastProxyHosts = new Set([
  "charlashispanas.com",
  "www.hoyhablamos.com",
]);

export function isOfficialPodcastProxyHost(hostname: string): boolean {
  return officialPodcastProxyHosts.has(hostname.toLowerCase());
}

export function acceptsPodcastAudioContentType(hostname: string, contentType: string | null | undefined): boolean {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (normalized === "audio/mpeg" || normalized === "audio/mp3") return true;
  return normalized === "application/octet-stream" && isOfficialPodcastProxyHost(hostname);
}

const feedDefinitions: readonly FeedDefinition[] = [
  {
    sourceNamePattern: /charlas\s+hispanas/iu,
    feedUrl: "https://charlashispanas.com/feed/podcast/",
    proxyHost: "https://charlashispanas.com",
  },
  {
    sourceNamePattern: /hoy\s+hablamos/iu,
    feedUrl: "https://www.hoyhablamos.com/category/podcast/feed/",
    proxyHost: "https://www.hoyhablamos.com",
  },
  {
    sourceNamePattern: /learncraft\s+spanish/iu,
    feedUrl: "https://rss.libsyn.com/shows/466488/destinations/3943362.xml",
  },
  {
    sourceNamePattern: /news\s+in\s+slow\s+spanish\s+latino/iu,
    feedUrl: "https://rss.libsyn.com/shows/45040/destinations/146316.xml",
  },
  {
    sourceNamePattern: /unlimited\s+spanish/iu,
    feedUrl: "https://unlimitedspanish.libsyn.com/rss",
  },
  {
    sourceNamePattern: /a\s+hombros\s+de\s+gigantes/iu,
    feedUrl: "https://api.rtve.es/api/programas/1873/audios.rss",
  },
  {
    sourceNamePattern: /no\s+hay\s+tos/iu,
    feedUrl: "https://feeds.simplecast.com/UrwSRKXH",
  },
  {
    sourceNamePattern: /el\s+dollop/iu,
    feedUrl: "https://feeds.simplecast.com/YVUZ6yUE",
  },
];

const officialFeedHosts = new Set(feedDefinitions.map((definition) => new URL(definition.feedUrl).hostname));
const maxFeedBytes = 2 * 1024 * 1024;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}

function cleanXmlText(value: string): string {
  return decodeXml(value).replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();
}

function normalizedText(value: string): string {
  return cleanXmlText(value).normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function pathStem(value: string): string {
  try {
    const url = new URL(value);
    const name = decodeURIComponent(url.pathname).split("/").at(-1) ?? "";
    return name.replace(/\.[^.]+$/u, "").toLocaleLowerCase();
  } catch {
    return "";
  }
}

function episodeId(value: string): string {
  try {
    const url = new URL(value);
    return decodeURIComponent(url.pathname).match(/\/episodes\/([^/]+)/iu)?.[1]?.toLocaleLowerCase() ?? "";
  } catch {
    return "";
  }
}

function firstTag(item: string, tag: string): string {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "iu").exec(item);
  return match ? cleanXmlText(match[1] ?? "") : "";
}

function enclosureUrls(item: string): string[] {
  return [...item.matchAll(/<enclosure\b[^>]*?\burl=["']([^"']+)["'][^>]*>/giu)]
    .map((match) => decodeXml(match[1] ?? "").trim())
    .filter(Boolean);
}

function feedDefinition(sourceName: string): FeedDefinition | null {
  return feedDefinitions.find((definition) => definition.sourceNamePattern.test(sourceName)) ?? null;
}

function candidateMatches(input: OfficialPodcastSourceInput, item: string, candidate: string): boolean {
  const currentEpisode = episodeId(input.currentUrl);
  const candidateEpisode = episodeId(candidate);
  if (currentEpisode && candidateEpisode && currentEpisode === candidateEpisode) return true;

  const currentStem = pathStem(input.currentUrl);
  const candidateStem = pathStem(candidate);
  if (currentStem && candidateStem) {
    const shorter = Math.min(currentStem.length, candidateStem.length);
    const longer = Math.max(currentStem.length, candidateStem.length);
    if (currentStem === candidateStem || (shorter >= 8 && (currentStem.includes(candidateStem) || candidateStem.includes(currentStem)) && shorter / longer >= 0.6)) return true;
  }

  const title = normalizedText(input.title);
  const itemTitle = normalizedText(firstTag(item, "title"));
  if (title.length >= 12 && itemTitle.length >= 12 && (title === itemTitle || title.includes(itemTitle) || itemTitle.includes(title))) return true;
  return false;
}

function safeCandidateUrl(raw: string, definition: FeedDefinition, isAllowedSourceHost: (hostname: string) => boolean): URL | null {
  try {
    const candidate = new URL(raw);
    if (candidate.protocol !== "https:" || candidate.username || candidate.password || !isAllowedSourceHost(candidate.hostname)) return null;
    if (!definition.proxyHost || !/(?:^|\.)blubrry\.com$/iu.test(candidate.hostname)) return candidate;
    const proxy = new URL(`${definition.proxyHost}/wp-content/plugins/simple-podcast-press/responsive_audio_player/downloadaudio.php`);
    proxy.searchParams.set("file", candidate.toString());
    if (!isAllowedSourceHost(proxy.hostname)) return null;
    return proxy;
  } catch {
    return null;
  }
}

/** Return a matching official enclosure, or null when the feed cannot prove identity. */
export async function resolveOfficialPodcastSource(
  input: OfficialPodcastSourceInput,
  options: OfficialPodcastSourceResolverOptions = {},
): Promise<URL | null> {
  const definition = feedDefinition(input.sourceName);
  if (!definition) return null;
  const feedUrl = new URL(definition.feedUrl);
  if (!officialFeedHosts.has(feedUrl.hostname)) return null;
  const fetcher = options.fetcher ?? fetch;
  const isAllowedSourceHost = options.isAllowedSourceHost ?? (() => true);
  try {
    const response = await fetcher(feedUrl, {
      headers: { accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxFeedBytes) {
      await response.body?.cancel();
      return null;
    }
    const xml = await response.text();
    if (xml.length > maxFeedBytes) return null;
    const items = xml.match(/<item\b[\s\S]*?<\/item>/giu) ?? [];
    for (const item of items) {
      for (const rawCandidate of enclosureUrls(item)) {
        if (!candidateMatches(input, item, rawCandidate)) continue;
        const candidate = safeCandidateUrl(rawCandidate, definition, isAllowedSourceHost);
        if (candidate) return candidate;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function officialPodcastFeedFor(sourceName: string): string | null {
  return feedDefinition(sourceName)?.feedUrl ?? null;
}
