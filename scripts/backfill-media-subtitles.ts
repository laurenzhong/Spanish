import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";
import { createOpenAITranscriptionProvider } from "../src/modules/providers/stt/openai-transcription";
import { downloadResumableAudio } from "../src/modules/media/storage/resumable-audio-download";

async function translateBatch(texts: readonly string[]): Promise<string[]> {
  const endpoint = process.env.MINIMAX_API_ENDPOINT?.trim() || "https://api.minimaxi.com/anthropic/v1/messages";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": process.env.MINIMAX_API_KEY! },
    body: JSON.stringify({ model: process.env.CONTENT_MEDIA_REVIEW_MODEL?.trim() || "MiniMax-M3", max_tokens: 6_000, thinking: { type: "disabled" }, system: `Translate each Spanish string to Simplified Chinese. Return JSON only as an array of exactly ${texts.length} strings in exactly the same order and count. Do not add markdown or explanations.`, messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(texts) }] }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "MEDIA_TRANSLATION_RATE_LIMITED" : "MEDIA_TRANSLATION_PROVIDER_FAILED");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const raw = payload.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim() ?? "";
  const cleaned = raw.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "");
  let parsed: unknown;
  try { parsed = JSON.parse(cleaned) as unknown; } catch { throw new Error("MEDIA_TRANSLATION_BATCH_JSON_INVALID"); }
  const values = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { translations?: unknown }).translations) ? (parsed as { translations: unknown[] }).translations : null;
  if (!values || values.length !== texts.length || values.some((value) => typeof value !== "string" || !value.trim())) throw new Error(`MEDIA_TRANSLATION_BATCH_SHAPE_INVALID:${values?.length ?? 0}/${texts.length}`);
  return values.map((value) => value.trim());
}

const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_PROVIDER_BYTES = 25 * 1024 * 1024;
const ALLOWED_HOSTS = new Set([
  "sueno-media.b-cdn.net", "content.libsyn.com", "traffic.libsyn.com", "content.blubrry.com", "media.blubrry.com", "ztnr.rtve.es",
  "episodes.castos.com", "simplecastaudio.com", "pscrb.fm", "anchor.fm", "injector.simplecastaudio.com", "sonoro.simplecastaudio.com",
  "prisa-es.mc.tritondigital.com", "mc.tritondigital.com", "rtve-mediavod-lote3.rtve.es",
  "dcs-cached.megaphone.fm", "dcs-spotify.megaphone.fm", "traffic.megaphone.fm", "www.podtrac.com", "dts.podtrac.com", "pdst.fm", "chrt.fm",
  "charlashispanas.com", "www.hoyhablamos.com",
]);

function isAllowedAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && (ALLOWED_HOSTS.has(host)
        || (ALLOWED_HOSTS.has("simplecastaudio.com") && host.endsWith(".simplecastaudio.com"))
        || (ALLOWED_HOSTS.has("pscrb.fm") && host.endsWith(".pscrb.fm"))
        || (ALLOWED_HOSTS.has("anchor.fm") && host.endsWith(".anchor.fm")));
  } catch {
    return false;
  }
}

function args() {
  const index = process.argv.indexOf("--stable-key");
  const stableKey = index >= 0 ? process.argv[index + 1] : undefined;
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 1;
  if (stableKey?.startsWith("--")) throw new Error("--stable-key is invalid");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error("--limit must be 1..10");
  if (!process.env.MINIMAX_API_KEY?.trim()) throw new Error("MINIMAX_API_KEY_REQUIRED");
  return { stableKey, limit };
}

async function download(url: string, directory: string, kind: string): Promise<{ path: string; bytes: number; hash: string }> {
  if (kind === "video") {
    const current = new URL(url);
    if (current.protocol !== "https:" || current.username || current.password || current.hostname !== "sueno-media.b-cdn.net") throw new Error("MEDIA_VIDEO_HOST_NOT_ALLOWED");
    const output = path.join(directory, "source.bin");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("curl.exe", ["-4", "--fail", "--location", "--retry", "3", "--retry-delay", "2", "--connect-timeout", "30", "--max-time", "3600", "--max-filesize", String(MAX_SOURCE_BYTES), "--output", output, current.toString()], { windowsHide: true, stdio: "ignore" });
      child.once("error", () => reject(new Error("MEDIA_VIDEO_CURL_UNAVAILABLE")));
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error("MEDIA_VIDEO_DOWNLOAD_FAILED")));
    });
    const info = await stat(output);
    if (!info.size) throw new Error("MEDIA_VIDEO_EMPTY");
    return { path: output, bytes: info.size, hash: createHash("sha256").update(await readFile(output)).digest("hex") };
  }
  const output = path.join(directory, "source.bin");
  const sourceHost = new URL(url).hostname.toLowerCase();
  const publisherProxy = sourceHost === "charlashispanas.com" || sourceHost === "www.hoyhablamos.com";
  if (publisherProxy) {
    let downloaded = false;
    for (let attempt = 0; attempt < 8 && !downloaded; attempt += 1) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("curl.exe", ["-4", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--retry", "3", "--retry-delay", "2", "--retry-all-errors", "--continue-at", "-", "--connect-timeout", "30", "--max-time", "900", "--max-filesize", String(MAX_SOURCE_BYTES), "--output", output, url], { windowsHide: true, stdio: "ignore" });
        child.once("error", () => reject(new Error("MEDIA_AUDIO_PROXY_UNAVAILABLE")));
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error("MEDIA_AUDIO_PROXY_DOWNLOAD_FAILED")));
      }).then(() => { downloaded = true; }).catch(async (error) => {
        if (attempt >= 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      });
    }
    const info = await stat(output);
    if (!info.size) throw new Error("MEDIA_AUDIO_PROXY_EMPTY");
    return { path: output, bytes: info.size, hash: createHash("sha256").update(await readFile(output)).digest("hex") };
  }
  try {
    const resumable = await downloadResumableAudio({
      source: async () => new URL(url), directory, allowedHosts: ALLOWED_HOSTS, maxBytes: MAX_SOURCE_BYTES,
      chunkSize: 8 * 1024 * 1024,
    });
    const handle = await open(output, "w");
    await handle.write(resumable);
    await handle.close();
    return { path: output, bytes: resumable.byteLength, hash: createHash("sha256").update(resumable).digest("hex") };
  } catch (error) {
    const source = new URL(url);
    if (!isAllowedAudioUrl(source.toString())) throw error;
    await new Promise<void>((resolve, reject) => {
      const child = spawn("curl.exe", ["-4", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--retry", "3", "--retry-delay", "2", "--connect-timeout", "30", "--max-time", "3600", "--max-filesize", String(MAX_SOURCE_BYTES), "--output", output, source.toString()], { windowsHide: true, stdio: "ignore" });
      child.once("error", () => reject(error));
      child.once("close", (code) => code === 0 ? resolve() : reject(error));
    });
    const info = await stat(output);
    if (!info.size) throw error;
    return { path: output, bytes: info.size, hash: createHash("sha256").update(await readFile(output)).digest("hex") };
  }
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">");
}

/**
 * Language Reactor's cached enclosure can expire or point at a source that
 * rejects datacenter requests. For the two registered Blubrry programs, the
 * publisher RSS feed is an equivalent, publicly listed enclosure source.
 * Match the existing episode filename before accepting a replacement URL.
 */
async function rssFallbackAudio(sourceName: string, currentUrl: string): Promise<string | null> {
  const feedUrl = sourceName.includes("Charlas Hispanas")
    ? "https://charlashispanas.com/feed/podcast/"
    : sourceName.includes("Hoy Hablamos")
      ? "https://www.hoyhablamos.com/category/podcast/feed/"
      : sourceName.includes("LearnCraft Spanish")
        ? "https://rss.libsyn.com/shows/466488/destinations/3943362.xml"
      : null;
  if (!feedUrl) return null;
  let currentPath: string;
  try { currentPath = decodeURIComponent(new URL(currentUrl).pathname).split("/").pop() ?? ""; }
  catch { return null; }
  const stem = currentPath.replace(/\.[^.]+$/u, "").toLowerCase();
  if (!stem) return null;
  try {
    const response = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    for (const item of xml.match(/<item\b[\s\S]*?<\/item>/giu) ?? []) {
      const enclosure = /<enclosure\b[^>]*?\burl=["']([^"']+)["']/iu.exec(item)?.[1];
      if (!enclosure) continue;
      let enclosureName = "";
      try {
        const enclosureUrl = new URL(decodeXml(enclosure));
        enclosureName = decodeURIComponent(enclosureUrl.pathname).split("/").pop()?.replace(/\.[^.]+$/u, "").toLowerCase() ?? "";
      } catch { continue; }
      if (enclosureName === stem || enclosureName.includes(stem) || stem.includes(enclosureName)) {
        const candidate = decodeXml(enclosure);
        if (!isAllowedAudioUrl(candidate)) continue;
        // The publishers expose a public download endpoint which fetches their
        // own RSS enclosure. It keeps the source and rights boundary intact
        // while avoiding a datacenter connection failure to media.blubrry.com.
        if (candidate.includes("media.blubrry.com/") || candidate.includes("content.blubrry.com/")) {
          const proxyHost = sourceName.includes("Charlas Hispanas") ? "https://charlashispanas.com" : "https://www.hoyhablamos.com";
          const proxy = new URL(`${proxyHost}/wp-content/plugins/simple-podcast-press/responsive_audio_player/downloadaudio.php`);
          proxy.searchParams.set("file", candidate);
          return proxy.toString();
        }
        return candidate;
      }
    }
  } catch { /* retain the original source failure */ }
  return null;
}

async function refreshLanguageReactorAudio(stableKey: string, sourceName: string, currentUrl: string): Promise<string | null> {
  if (!stableKey.startsWith("podcast.language-reactor.")) return null;
  const docId = stableKey.slice("podcast.language-reactor.".length);
  const response = await fetch("https://api-cdn.dioco.io/base_media_getMediaDocs_5", {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100000 }, lang_G: "es", filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es", diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: docId, offset: 0, limit: 100 }),
  });
  if (response.ok) {
    const payload = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
    const found = payload.data?.docs_metadata?.find((item) => item.diocoDocId?.toLowerCase() === docId.toLowerCase());
    if (found?.audioFileURL && isAllowedAudioUrl(found.audioFileURL)) return found.audioFileURL;
  }
  return rssFallbackAudio(sourceName, currentUrl);
}

async function normalize(input: string, directory: string): Promise<{ path: string; bytes: number }> {
  const output = path.join(directory, "normalized.mp3");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_BIN?.trim() || "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", output], { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`MEDIA_AUDIO_NORMALIZE_FAILED:${error.slice(0, 200)}`)));
  });
  const info = await stat(output);
  if (!info.size || info.size > MAX_PROVIDER_BYTES) throw new Error("MEDIA_AUDIO_PROVIDER_SIZE_INVALID");
  return { path: output, bytes: info.size };
}

type TimedTranscript = Readonly<{ startMs: number; endMs: number; text: string }>;
type SubtitleChunk = { startMs: number; endMs: number; text: string; words?: readonly { startMs: number; endMs: number; startOffset: number; endOffset: number; text: string }[] };

function sentenceChunks(text: string, durationMs: number, timedSegments: readonly TimedTranscript[] = []): SubtitleChunk[] {
  if (timedSegments.length > 0) {
    const chunks: SubtitleChunk[] = [];
    let current: TimedTranscript[] = [];
    const flush = () => {
      if (!current.length) return;
      const sourceText = current.map((part) => part.text.trim()).filter(Boolean).join(" ").trim();
      if (!sourceText) { current = []; return; }
      const matches = Array.from(sourceText.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?(?:[/:.-][\p{N}]+)*/gu));
      const words = current.length === matches.length ? current.map((part, index) => {
        const startOffset = matches[index]?.index ?? 0;
        const token = matches[index]?.[0] ?? "";
        return { startMs: part.startMs, endMs: part.endMs, startOffset, endOffset: startOffset + token.length, text: token };
      }) : undefined;
      chunks.push({ startMs: current[0]!.startMs, endMs: current.at(-1)!.endMs, text: sourceText, ...(words ? { words } : {}) });
      current = [];
    };
    for (const part of timedSegments) {
      current.push(part);
      if (/[.!?。！？]["'”’)]*$/u.test(part.text.trim())) flush();
    }
    flush();
    if (chunks.length) return chunks;
  }
  const values = text.match(/[^.!?。！？]+[.!?。！？]?/gu)?.map((value) => value.trim()).filter(Boolean) ?? [];
  const chunks = values.length ? values : [text.trim()].filter(Boolean);
  return chunks.map((value, index) => ({ startMs: Math.floor(index * durationMs / chunks.length), endMs: index === chunks.length - 1 ? durationMs : Math.max(1, Math.floor((index + 1) * durationMs / chunks.length)), text: value }));
}

async function main() {
  const { stableKey, limit } = args();
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const rows = await sql.unsafe(`select i.id as item_id,i.stable_key,i.kind,v.id as version_id,v.version,v.title,v.summary,v.source_name,v.language,v.duration_ms,a.playback_url,a.provider_key from media_items i join media_versions v on v.media_item_id=i.id and v.version=i.current_version join media_assets a on a.media_version_id=v.id and a.availability='available' where v.status='published' and v.copyright_status='cleared' and not exists(select 1 from media_segments s where s.media_version_id=v.id) and ($1::text is null or i.stable_key=$1) order by i.kind,i.stable_key limit $2`, [stableKey ?? null, limit]);
  if (!rows.length) { console.log(JSON.stringify({ status: "nothing-to-backfill" })); await sql.end(); return; }
  const results: unknown[] = [];
  for (const row of rows) {
    const directory = await mkdtemp(path.join(tmpdir(), "sueno-media-backfill-"));
    try {
      const rssCandidate = row.provider_key === "bunny-storage" ? null : await rssFallbackAudio(String(row.source_name), String(row.playback_url));
      const refreshedCandidate = rssCandidate ?? (row.provider_key === "bunny-storage" ? null : await refreshLanguageReactorAudio(String(row.stable_key), String(row.source_name), String(row.playback_url)));
      const refreshed = refreshedCandidate && isAllowedAudioUrl(refreshedCandidate) ? refreshedCandidate : null;
      console.log(JSON.stringify({ stableKey: row.stable_key, stage: "source-resolved" }));
      let source;
      try {
        source = await download(refreshed ?? String(row.playback_url), directory, String(row.kind));
      } catch (downloadError) {
        const rssCandidate = await rssFallbackAudio(String(row.source_name), String(row.playback_url));
        if (!rssCandidate || rssCandidate === refreshed || rssCandidate === String(row.playback_url)) throw downloadError;
        console.log(JSON.stringify({ stableKey: row.stable_key, stage: "source-rss-fallback" }));
        source = await download(rssCandidate, directory, String(row.kind));
      }
      console.log(JSON.stringify({ stableKey: row.stable_key, stage: "source-downloaded", bytes: source.bytes }));
      const normalized = await normalize(source.path, directory);
      console.log(JSON.stringify({ stableKey: row.stable_key, stage: "audio-normalized", bytes: normalized.bytes }));
      const transcriptionInput = { audioBytes: new Uint8Array(await readFile(normalized.path)), assetPath: normalized.path, mimeType: "audio/mpeg", fileName: "media.mp3", languageTag: "es", durationMs: Number(row.duration_ms) } as const;
      let transcription;
      for (let attempt = 0; ; attempt += 1) {
        try {
          transcription = await createMiniMaxTranscriptionProvider({
            timeoutMs: Number(row.duration_ms) >= 10 * 60_000 ? 60 * 60_000 : 10 * 60_000,
            timestampLevel: "word",
          }).transcribe(transcriptionInput);
          break;
        } catch (error) {
          const retryable = error instanceof Error && /temporarily unavailable|rate limit|timed out/iu.test(error.message);
          if (process.env.OPENAI_API_KEY?.trim() && retryable && attempt >= 2) {
            transcription = await createOpenAITranscriptionProvider({
              timeoutMs: Number(row.duration_ms) >= 10 * 60_000 ? 60 * 60_000 : 10 * 60_000,
              endpoint: process.env.OPENAI_TRANSCRIPTION_ENDPOINT?.trim() || undefined,
              model: process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || undefined,
            }).transcribe(transcriptionInput);
            break;
          }
          if (!retryable || attempt >= 2) throw error;
          await new Promise((resolve) => setTimeout(resolve, 10_000 * (attempt + 1)));
        }
      }
      console.log(JSON.stringify({ stableKey: row.stable_key, stage: "transcribed" }));
      const chunks = sentenceChunks(transcription.text, Number(row.duration_ms), transcription.segments ?? []);
      const translations: Array<string | null> = Array.from({ length: chunks.length }, () => null);
      for (let offset = 0; offset < chunks.length;) {
        let end = offset;
        let joinedLength = 0;
        while (end < chunks.length && end - offset < 8 && joinedLength + chunks[end]!.text.length + 8 <= 3_800) {
          joinedLength += chunks[end]!.text.length + 8;
          end += 1;
        }
        if (end === offset) end += 1;
        let values: string[] | null = null;
        const batchTexts = chunks.slice(offset, end).map((chunk) => chunk.text);
        for (let attempt = 0; attempt < 4 && !values; attempt += 1) {
          try { values = await translateBatch(batchTexts); }
          catch (error) {
            if (attempt === 3) {
              const individual: string[] = [];
              for (const text of batchTexts) {
                let translated: string[] | null = null;
                for (let retry = 0; retry < 4 && !translated; retry += 1) {
                  try { translated = await translateBatch([text]); }
                  catch (individualError) { if (retry === 3) throw individualError; await new Promise((resolve) => setTimeout(resolve, 5_000 * (retry + 1))); }
                }
                if (!translated || translated.length !== 1) throw error;
                individual.push(translated[0]!);
              }
              values = individual;
            } else await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
          }
        }
        if (!values || values.length !== end - offset) {
          const individual: string[] = [];
          for (const text of batchTexts) {
            const translated = await translateBatch([text]);
            if (translated.length !== 1) throw new Error("MEDIA_TRANSLATION_BATCH_SHAPE_INVALID");
            individual.push(translated[0]!);
          }
          values = individual;
        }
        values.forEach((value, index) => { translations[offset + index] = value; });
        offset = end;
      }
      const segments = chunks.map((chunk, index) => ({ index, startMs: chunk.startMs, endMs: chunk.endMs, sourceText: chunk.text, translation: translations[index], speaker: null, confidence: transcription.confidence, sourceKind: "asr", words: chunk.words ?? null }));
      const inserted = await sql`insert into media_transcript_backfills (id,media_version_id,media_item_id,source_version,audio_hash,segments,provider,model_version,low_confidence,translation_failed_count,status,created_at,updated_at) values (${randomUUID()},${row.version_id},${row.item_id},${row.version},${source.hash},${JSON.stringify(segments)},${transcription.provider},${transcription.modelVersion},false,0,'draft',now(),now()) on conflict (media_version_id,audio_hash) do nothing returning id`;
      results.push({ stableKey: row.stable_key, status: inserted.length ? "draft-created" : "duplicate", segments: segments.length, bytes: normalized.bytes });
    } catch (error) {
      results.push({ stableKey: row.stable_key, status: "failed", code: error instanceof Error ? error.message : "MEDIA_BACKFILL_FAILED" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ results }));
  await sql.end();
}

main().catch((error) => {
  const code = error instanceof Error && error.message.trim() ? error.message : error instanceof Error ? error.name : "MEDIA_BACKFILL_FAILED";
  console.error(JSON.stringify({ status: "failed", code }));
  process.exitCode = 1;
});
