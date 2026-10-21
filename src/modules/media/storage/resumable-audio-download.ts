import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** Ranged podcast reads are audio; a caller may widen this for a host that does not honour it. */
const defaultAudioContentTypes = new Set(["audio/mpeg", "audio/mp3"]);

function allowedHost(hostname: string, hosts: ReadonlySet<string>): boolean {
  const host = hostname.toLowerCase();
  return hosts.has(host)
    || (hosts.has("mc.tritondigital.com") && host.endsWith(".mc.tritondigital.com"))
    || (hosts.has("simplecastaudio.com") && host.endsWith(".simplecastaudio.com"))
    || (hosts.has("pscrb.fm") && host.endsWith(".pscrb.fm"))
    || (hosts.has("anchor.fm") && host.endsWith(".anchor.fm"));
}

/** Persist only verified chunks; never persist source signatures or credentials. */
export async function downloadResumableAudio(options: {
  source: () => Promise<URL>;
  directory: string;
  allowedHosts: ReadonlySet<string>;
  maxBytes: number;
  fetcher?: typeof fetch;
  chunkSize?: number;
  retryDelayMs?: number;
  /**
   * Content types accepted for the ranged read. Some podcast hosts serve audio
   * as a generic binary stream, so a caller may widen this; it is never widened
   * for us, and a mismatched type still fails the range.
   */
  acceptedContentTypes?: ReadonlySet<string>;
  progress?: (bytes: number, total: number) => void;
}) {
  const fetcher = options.fetcher ?? fetch;
  const acceptedContentTypes = options.acceptedContentTypes ?? defaultAudioContentTypes;
  async function request(start: number, end: number, validator?: string) {
    let url = await options.source();
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== "https:" || url.username || url.password || !allowedHost(url.hostname, options.allowedHosts)) throw new Error("AUDIO_SOURCE_NOT_ALLOWED");
      let response: Response;
      try {
        response = await fetcher(url, { headers: { range: `bytes=${start}-${end}`, ...(validator ? { "if-range": validator } : {}) }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
      } catch { throw new Error("AUDIO_RANGE_NETWORK_FAILED"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new Error("AUDIO_REDIRECT_INVALID");
        url = new URL(location, url); continue;
      }
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new Error(`AUDIO_RANGE_HTTP_${response.status}`);
      }
      return response;
    }
    throw new Error("AUDIO_TOO_MANY_REDIRECTS");
  }
  async function retry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await operation(); } catch (error) {
        if (attempt >= 4 || (error instanceof Error && /AUDIO_(SOURCE_NOT_ALLOWED|SOURCE_CHANGED|RANGE_INVALID|SIZE_INVALID)/u.test(error.message))) throw error;
        await new Promise((done) => setTimeout(done, (options.retryDelayMs ?? 1000) * (attempt + 1)));
      }
    }
  }
  const probe = await retry(() => request(0, 31));
  const match = /^bytes 0-31\/(\d+)$/u.exec(probe.headers.get("content-range") ?? "");
  const etag = probe.headers.get("etag");
  const validator = etag && !etag.startsWith("W/") ? etag : undefined;
  await probe.body?.cancel();
  const total = Number(match?.[1]);
  if (!Number.isSafeInteger(total) || total < 32 || total > options.maxBytes) throw new Error("AUDIO_SIZE_INVALID");
  const chunkSize = options.chunkSize ?? 1024 * 1024;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error("AUDIO_SIZE_INVALID");
  // Without a strong validator, never combine cached data with a new response.
  const source = await options.source();
  const identity = digest(JSON.stringify({ resource: `${source.origin}${source.pathname}`, total, validator, chunkSize }));
  const directory = resolve(options.directory, `ranges-${identity}`);
  await mkdir(directory, { recursive: true });
  const chunks: Buffer[] = [];
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total - 1, start + chunkSize - 1);
    const path = resolve(directory, `${start}.part`);
    let bytes: Buffer | undefined;
    if (validator) {
      try {
        const cached = await readFile(path);
        if (cached.length === end - start + 1 && digest(cached) === await readFile(`${path}.sha256`, "utf8")) bytes = cached;
      } catch { /* No fully checkpointed chunk. */ }
    }
    if (!bytes) {
      bytes = await retry(async () => {
        const response = await request(start, end, validator);
        if (response.headers.get("content-range") !== `bytes ${start}-${end}/${total}` || !acceptedContentTypes.has(response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "")) {
          await response.body?.cancel(); throw new Error("AUDIO_RANGE_INVALID");
        }
        if (validator && response.headers.get("etag") !== validator) {
          await response.body?.cancel(); throw new Error("AUDIO_SOURCE_CHANGED");
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error("AUDIO_RANGE_INVALID");
        const parts: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.length;
            if (size > end - start + 1) throw new Error("AUDIO_RANGE_INVALID");
            parts.push(next.value);
          }
        } catch (error) {
          if (error instanceof Error && error.message === "AUDIO_RANGE_INVALID") throw error;
          throw new Error("AUDIO_RANGE_NETWORK_FAILED");
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (size !== end - start + 1) throw new Error("AUDIO_DOWNLOAD_INCOMPLETE");
        return Buffer.concat(parts);
      });
      await writeFile(`${path}.new`, bytes); await rename(`${path}.new`, path);
      await writeFile(`${path}.sha256.new`, digest(bytes)); await rename(`${path}.sha256.new`, `${path}.sha256`);
    }
    chunks.push(bytes); options.progress?.(end + 1, total);
  }
  return Buffer.concat(chunks);
}
