/**
 * Hosts this product is willing to download podcast and video media from.
 *
 * The list is deliberately explicit: it is the allowlist behind every media
 * download path (the stream proxy, the acquisition backfills and the official
 * publisher fallback). Nothing may widen it at runtime.
 */
const allowedMediaSourceHosts = new Set([
  "sueno-media.b-cdn.net",
  "content.libsyn.com",
  "traffic.libsyn.com",
  "traffic.megaphone.fm",
  "dcs-cached.megaphone.fm",
  "dcs-spotify.megaphone.fm",
  "content.blubrry.com",
  "media.blubrry.com",
  "episodes.castos.com",
  "simplecastaudio.com",
  "pscrb.fm",
  "anchor.fm",
  "injector.simplecastaudio.com",
  "sonoro.simplecastaudio.com",
  "prisa-es.mc.tritondigital.com",
  "mc.tritondigital.com",
  "api.rtve.es",
  "feeds.simplecast.com",
  "charlashispanas.com",
  "www.hoyhablamos.com",
  "pdst.fm",
  "chrt.fm",
  "www.podtrac.com",
  "dts.podtrac.com",
  "rtve-mediavod-lote3.rtve.es",
  "ztnr.rtve.es",
]);

/** Sub-domains of Triton Digital's CDN serve the same verified shows. */
const allowedMediaSourceSuffixes = [".mc.tritondigital.com"];

/**
 * Stricter than the acquisition backfills' own list on purpose: the backfills
 * may follow the podcast networks' auxiliary hosts, while the product-facing
 * policy only trusts the hosts the published catalogue was verified against.
 */
export function isAllowedMediaSourceHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return allowedMediaSourceHosts.has(host) || allowedMediaSourceSuffixes.some((suffix) => host.endsWith(suffix));
}

export const mediaSourceHosts: readonly string[] = [...allowedMediaSourceHosts];
