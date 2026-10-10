import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";
import { downloadResumableAudio } from "../src/modules/media/storage/resumable-audio-download";
import { acceptsPodcastAudioContentType, resolveOfficialPodcastSource } from "../src/modules/media/storage/podcast-source-resolver";
import { validWordTimings } from "../src/modules/media/domain/word-timeline";

const allowedHosts = new Set([
  "sueno-media.b-cdn.net", "content.libsyn.com", "traffic.libsyn.com", "traffic.megaphone.fm",
  "dcs-cached.megaphone.fm", "dcs-spotify.megaphone.fm", "content.blubrry.com", "media.blubrry.com",
  "episodes.castos.com", "simplecastaudio.com", "pscrb.fm", "anchor.fm", "injector.simplecastaudio.com", "sonoro.simplecastaudio.com",
  "prisa-es.mc.tritondigital.com", "mc.tritondigital.com", "api.rtve.es", "feeds.simplecast.com",
  "charlashispanas.com", "www.hoyhablamos.com",
  "pdst.fm", "chrt.fm", "www.podtrac.com", "dts.podtrac.com",
  "rtve-mediavod-lote3.rtve.es", "ztnr.rtve.es",
]);
const tokenPattern = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?(?:[/:.-][\p{N}]+)*/gu;

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return allowedHosts.has(host)
    || (allowedHosts.has("mc.tritondigital.com") && host.endsWith(".mc.tritondigital.com"))
    || (allowedHosts.has("simplecastaudio.com") && host.endsWith(".simplecastaudio.com"))
    || (allowedHosts.has("pscrb.fm") && host.endsWith(".pscrb.fm"))
    || (allowedHosts.has("anchor.fm") && host.endsWith(".anchor.fm"));
}

function normalizeToken(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
}

function tokenOffsets(text: string) {
  return Array.from(text.matchAll(tokenPattern)).map((match) => ({ text: match[0], startOffset: match.index ?? 0, endOffset: (match.index ?? 0) + match[0].length }));
}

async function download(url: string, directory: string): Promise<{ path: string; hash: string }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) throw new Error("WORD_TIMING_SOURCE_NOT_ALLOWED");
  const output = path.join(directory, "source.bin");
  if (parsed.hostname === "sueno-media.b-cdn.net") {
    try {
      const bytes = await downloadResumableAudio({
        source: async () => parsed,
        directory,
        allowedHosts,
        maxBytes: 512 * 1024 * 1024,
        chunkSize: 2 * 1024 * 1024,
        acceptedContentTypes: new Set(["video/mp4", "audio/mpeg", "audio/mp3"]),
      });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(output, bytes);
    } catch (error) {
      // Some Windows Node builds reset Bunny's TLS connection while curl can
      // complete the same public range request. Keep the fallback host- and
      // size-scoped; never broaden this to arbitrary source URLs.
      if (!(error instanceof Error) || !/AUDIO_RANGE_NETWORK_FAILED/u.test(error.message)) throw error;
      await new Promise<void>((resolve, reject) => {
        const child = spawn("curl.exe", [
          "-4", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https",
          "--retry", "5", "--retry-delay", "2", "--retry-all-errors", "--connect-timeout", "30",
          "--max-time", "1_800", "--max-filesize", String(512 * 1024 * 1024), "--output", output, parsed.toString(),
        ], { windowsHide: true, stdio: "ignore" });
        child.once("error", () => reject(new Error("WORD_TIMING_CURL_UNAVAILABLE")));
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error("WORD_TIMING_CURL_DOWNLOAD_FAILED")));
      });
    }
  } else if (["charlashispanas.com", "www.hoyhablamos.com", "traffic.libsyn.com"].includes(parsed.hostname.toLowerCase())) {
    let downloaded = false;
    for (let attempt = 0; attempt < 8 && !downloaded; attempt += 1) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn("curl.exe", ["-4", "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--retry", "3", "--retry-delay", "2", "--retry-all-errors", "--continue-at", "-", "--connect-timeout", "30", "--max-time", "900", "--max-filesize", String(512 * 1024 * 1024), "--output", output, parsed.toString()], { windowsHide: true, stdio: "ignore" });
        child.once("error", () => reject(new Error("WORD_TIMING_PROXY_UNAVAILABLE")));
        child.once("close", (code) => code === 0 ? resolve() : reject(new Error("WORD_TIMING_PROXY_DOWNLOAD_FAILED")));
      }).then(() => { downloaded = true; }).catch(async (error) => {
        if (attempt >= 7) throw error;
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      });
    }
  } else {
    const bytes = await downloadResumableAudio({
      source: async () => parsed,
      directory,
      allowedHosts,
      maxBytes: 512 * 1024 * 1024,
      chunkSize: 8 * 1024 * 1024,
      acceptedContentTypes: new Set(["audio/mpeg", "audio/mp3", "application/octet-stream"].filter((contentType) => acceptsPodcastAudioContentType(parsed.hostname, contentType))),
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(output, bytes);
  }
  const bytes = await readFile(output);
  if (!bytes.length) throw new Error("WORD_TIMING_EMPTY_SOURCE");
  return { path: output, hash: createHash("sha256").update(bytes).digest("hex") };
}

async function officialPodcastFallback(sourceName: string, currentUrl: string): Promise<string | null> {
  const feedUrl = sourceName.includes("Charlas Hispanas")
    ? "https://charlashispanas.com/feed/podcast/"
    : sourceName.includes("Hoy Hablamos")
      ? "https://www.hoyhablamos.com/category/podcast/feed/"
      : sourceName.includes("LearnCraft Spanish")
        ? "https://rss.libsyn.com/shows/466488/destinations/3943362.xml"
        : null;
  if (!feedUrl) return null;
  let stem = "";
  try { stem = decodeURIComponent(new URL(currentUrl).pathname).split("/").pop()?.replace(/\.[^.]+$/u, "").toLowerCase() ?? ""; } catch { return null; }
  if (!stem) return null;
  try {
    const response = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const xml = await response.text();
    for (const item of xml.match(/<item\b[\s\S]*?<\/item>/giu) ?? []) {
      const raw = /<enclosure\b[^>]*?\burl=["']([^"']+)/iu.exec(item)?.[1];
      if (!raw) continue;
      const candidate = new URL(raw);
      const name = decodeURIComponent(candidate.pathname).split("/").pop()?.replace(/\.[^.]+$/u, "").toLowerCase() ?? "";
      if (!(name === stem || name.includes(stem) || stem.includes(name))) continue;
      if (candidate.hostname === "media.blubrry.com" || candidate.hostname === "content.blubrry.com") {
        const host = sourceName.includes("Charlas Hispanas") ? "https://charlashispanas.com" : "https://www.hoyhablamos.com";
        const proxy = new URL(`${host}/wp-content/plugins/simple-podcast-press/responsive_audio_player/downloadaudio.php`);
        proxy.searchParams.set("file", candidate.toString());
        return proxy.toString();
      }
      return candidate.toString();
    }
  } catch { /* retain the stored source when the public feed is unavailable */ }
  return null;
}

async function refreshLanguageReactorAudio(stableKey: string): Promise<string | null> {
  if (!stableKey.startsWith("podcast.language-reactor.")) return null;
  const docId = stableKey.slice("podcast.language-reactor.".length);
  try {
    const response = await fetch("https://api-cdn.dioco.io/base_media_getMediaDocs_5", {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100000 }, lang_G: "es", filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es", diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: docId, offset: 0, limit: 100 }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
    const found = payload.data?.docs_metadata?.find((item) => item.diocoDocId?.toLowerCase() === docId.toLowerCase());
    return found?.audioFileURL ?? null;
  } catch { return null; }
}

async function normalize(input: string, directory: string): Promise<string> {
  const output = path.join(directory, "normalized.mp3");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_BIN?.trim() || "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k", output], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error("WORD_TIMING_NORMALIZE_FAILED")));
  });
  if (!(await stat(output)).size) throw new Error("WORD_TIMING_NORMALIZE_EMPTY");
  return output;
}

function args() {
  const index = process.argv.indexOf("--stable-key");
  const stableKey = index >= 0 ? process.argv[index + 1] : undefined;
  if (!stableKey || stableKey.startsWith("--")) throw new Error("--stable-key is required");
  const deterministic = process.argv.includes("--deterministic");
  if (!deterministic && !process.env.MINIMAX_API_KEY?.trim()) throw new Error("MINIMAX_API_KEY_REQUIRED");
  return { stableKey, deterministic };
}

type ExistingWord = { startMs: number; endMs: number; startOffset: number; endOffset: number; text?: string };
type ExistingSegment = { index: number; startMs: number; endMs: number; sourceText: string; translation: string | null; speaker: string | null; sourceKind: string | null; confidence: number | null; words: ExistingWord[] | null };

/**
 * Fill the lexical text from the already-published UTF-16 offsets.  This is
 * deliberately fail-closed: a malformed offset timeline must go through ASR
 * instead of being repaired by guessing.
 */
function deterministicWordPayload(segments: readonly ExistingSegment[]) {
  return segments.map((segment) => {
    const words = Array.isArray(segment.words) ? segment.words : [];
    // Ignore legacy/mismatched text while validating the immutable offsets.
    const structureWords = words.map(({ text: _text, ...timing }) => timing);
    const valid = validWordTimings({
      sourceText: segment.sourceText,
      startMs: segment.startMs,
      endMs: segment.endMs,
      words: structureWords,
    });
    if (valid.length === 0 || valid.length !== words.length) {
      throw new Error(`WORD_TIMING_DETERMINISTIC_UNSAFE:${segment.index}`);
    }
    return {
      ...segment,
      words: valid.map((word) => ({
        ...word,
        text: segment.sourceText.slice(word.startOffset, word.endOffset),
      })),
    };
  });
}

async function createDeterministicDraft(sql: postgres.Sql, row: {
  item_id: string;
  version_id: string;
  version: number;
  segments: ExistingSegment[];
}) {
  const payload = deterministicWordPayload(row.segments);
  const audioHash = createHash("sha256").update(JSON.stringify({ sourceVersion: row.version_id, segments: payload })).digest("hex");
  const [inserted] = await sql`
    insert into media_transcript_backfills
      (id,media_version_id,media_item_id,source_version,audio_hash,segments,provider,model_version,low_confidence,translation_failed_count,status,created_at,updated_at)
    values
      (${randomUUID()},${row.version_id},${row.item_id},${row.version},${audioHash},${sql.json(payload)},'deterministic-offset-text','offset-text-v1',false,0,'draft',now(),now())
    on conflict (media_version_id,audio_hash) do nothing
    returning id
  `;
  return { status: inserted ? "draft-created" : "duplicate", segments: payload.length, words: payload.reduce((sum, segment) => sum + (segment.words?.length ?? 0), 0) };
}

async function translateBatch(texts: readonly string[]): Promise<string[]> {
  const response = await fetch(process.env.MINIMAX_API_ENDPOINT?.trim() || "https://api.minimaxi.com/anthropic/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": process.env.MINIMAX_API_KEY! },
    body: JSON.stringify({ model: process.env.CONTENT_MEDIA_REVIEW_MODEL?.trim() || "MiniMax-M3", max_tokens: 6_000, thinking: { type: "disabled" }, system: `Translate each Spanish string to Simplified Chinese. Return JSON only as an array of exactly ${texts.length} strings in the same order.`, messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(texts) }] }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("WORD_TIMING_TRANSLATION_FAILED");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const raw = payload.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim().replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "") ?? "";
  let values: unknown;
  try { values = JSON.parse(raw) as unknown; }
  catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("WORD_TIMING_TRANSLATION_JSON_INVALID");
    values = JSON.parse(raw.slice(start, end + 1)) as unknown;
  }
  if (!Array.isArray(values) || values.length !== texts.length || values.some((value) => typeof value !== "string" || !value.trim())) throw new Error("WORD_TIMING_TRANSLATION_SHAPE_INVALID");
  return values.map((value) => String(value).trim());
}

async function translateOne(text: string): Promise<string> {
  const response = await fetch(process.env.MINIMAX_API_ENDPOINT?.trim() || "https://api.minimaxi.com/anthropic/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": process.env.MINIMAX_API_KEY! },
    body: JSON.stringify({ model: process.env.CONTENT_MEDIA_REVIEW_MODEL?.trim() || "MiniMax-M3", max_tokens: 500, thinking: { type: "disabled" }, system: "Translate the Spanish sentence to Simplified Chinese. Return only the Chinese translation, with no quotes, JSON, markdown, or explanation.", messages: [{ role: "user", content: [{ type: "text", text }] }] }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error("WORD_TIMING_TRANSLATION_FAILED");
  const payload = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const value = payload.content?.filter((block) => block.type === "text").map((block) => block.text ?? "").join(" ").trim().replace(/^```[\s\S]*?\n/gu, "").replace(/\n```$/gu, "").replace(/^['"]|['"]$/gu, "").trim();
  if (!value) throw new Error("WORD_TIMING_TRANSLATION_EMPTY");
  return value;
}

function providerChunks(timed: readonly { startMs: number; endMs: number; text: string }[]) {
  const chunks: Array<{ startMs: number; endMs: number; sourceText: string; words: Array<{ startMs: number; endMs: number; startOffset: number; endOffset: number; text: string }> }> = [];
  let current: typeof timed[number][] = [];
  const flush = () => {
    if (!current.length) return;
    const sourceText = current.map((part) => part.text.trim()).filter(Boolean).join(" ").trim();
    const tokens = tokenOffsets(sourceText);
    const words = [];
    let tokenCursor = 0;
    for (const part of current) {
      const partTokens = tokenOffsets(part.text);
      if (!partTokens.length) continue;
      const first = tokens[tokenCursor];
      const last = tokens[tokenCursor + partTokens.length - 1];
      if (!first || !last) throw new Error(`WORD_TIMING_PROVIDER_TOKEN_SHAPE_INVALID:${tokens.length}/${current.length}`);
      words.push({ startMs: part.startMs, endMs: part.endMs, startOffset: first.startOffset, endOffset: last.endOffset, text: sourceText.slice(first.startOffset, last.endOffset) });
      tokenCursor += partTokens.length;
    }
    if (tokenCursor !== tokens.length) throw new Error(`WORD_TIMING_PROVIDER_TOKEN_SHAPE_INVALID:${tokens.length}/${tokenCursor}`);
    chunks.push({ startMs: current[0]!.startMs, endMs: current.at(-1)!.endMs, sourceText, words });
    current = [];
  };
  for (const part of timed) {
    current.push(part);
    if (/[.!?。！？]["'”’)]*$/u.test(part.text.trim())) flush();
  }
  flush();
  return chunks;
}

async function main() {
  const { stableKey, deterministic } = args();
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const [row] = await sql.unsafe(`select i.id as item_id,i.stable_key,v.id as version_id,v.version,v.duration_ms,v.source_name,v.title,a.playback_url,a.provider_key,json_agg(json_build_object('index',s.segment_index,'startMs',s.start_ms,'endMs',s.end_ms,'sourceText',s.source_text,'translation',s.translation,'speaker',s.speaker,'sourceKind',s.source_kind,'confidence',s.confidence,'words',s.words) order by s.segment_index) as segments from media_items i join media_versions v on v.media_item_id=i.id and v.version=i.current_version join media_assets a on a.media_version_id=v.id and a.availability='available' join media_segments s on s.media_version_id=v.id and s.review_status='approved' where i.stable_key=$1 and v.status='published' group by i.id,i.stable_key,v.id,v.version,v.duration_ms,v.source_name,v.title,a.playback_url,a.provider_key`, [stableKey]);
  if (!row) throw new Error("MEDIA_NOT_FOUND");
  if (deterministic) {
    const result = await createDeterministicDraft(sql, row as unknown as { item_id: string; version_id: string; version: number; segments: ExistingSegment[] });
    console.log(JSON.stringify({ stableKey, ...result, mode: "deterministic" }));
    await sql.end();
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "sueno-word-timing-"));
  try {
    const official = row.provider_key === "bunny-storage" ? null : await resolveOfficialPodcastSource({
      sourceName: String(row.source_name ?? ""),
      title: String(row.title ?? ""),
      currentUrl: String(row.playback_url),
    }, { isAllowedSourceHost: (hostname) => allowedHosts.has(hostname.toLowerCase()) });
    const refreshed = official?.toString() ?? await refreshLanguageReactorAudio(String(row.stable_key));
    let sourceUrl = String(row.playback_url);
    if (refreshed) {
      try { if (isAllowedHost(new URL(refreshed).hostname)) sourceUrl = refreshed; } catch { /* retain the verified stored asset */ }
    }
    const source = await download(sourceUrl, directory);
    const normalizedPath = await normalize(source.path, directory);
    const transcription = await createMiniMaxTranscriptionProvider({ timestampLevel: "word", timeoutMs: Number(row.duration_ms) >= 600_000 ? 3_600_000 : 900_000 }).transcribe({ audioBytes: new Uint8Array(await readFile(normalizedPath)), assetPath: normalizedPath, mimeType: "audio/mpeg", fileName: "media.mp3", languageTag: "es", durationMs: Number(row.duration_ms) });
    const timed = transcription.segments ?? [];
    if (!timed.length) throw new Error("WORD_TIMING_PROVIDER_NO_WORDS");
    let cursor = 0;
    const segments = (row.segments as Array<{ index: number; startMs: number; endMs: number; sourceText: string; translation: string | null; speaker: string | null; sourceKind: string | null; confidence: number | null }>).map((segment) => {
      const sourceTokens = tokenOffsets(segment.sourceText);
      const words = [];
      for (const sourceToken of sourceTokens) {
        const wanted = normalizeToken(sourceToken.text);
        let found = -1;
        for (let index = cursor; index < timed.length; index += 1) {
          const candidate = normalizeToken(timed[index]!.text);
          if (candidate === wanted && timed[index]!.startMs < segment.endMs + 2_000 && timed[index]!.endMs > segment.startMs - 2_000) { found = index; break; }
        }
        if (found < 0) return { ...segment, words: null, _failed: true, _failedToken: sourceToken.text, _cursor: cursor, _nextTimed: timed.slice(cursor, cursor + 8).map((part) => part.text).join(" ") };
        const match = timed[found]!;
        cursor = found + 1;
        words.push({ startMs: Math.max(segment.startMs, match.startMs), endMs: Math.min(segment.endMs, match.endMs), startOffset: sourceToken.startOffset, endOffset: sourceToken.endOffset, text: sourceToken.text });
      }
      return { ...segment, words, _failed: false };
    });
    const failedSegment = segments.find((segment) => segment._failed);
    let payload;
    if (failedSegment) {
      const regenerated = providerChunks(timed);
      const translations: string[] = [];
      for (let offset = 0; offset < regenerated.length; offset += 8) {
        const batch = regenerated.slice(offset, offset + 8).map((chunk) => chunk.sourceText);
        try { translations.push(...await translateBatch(batch)); }
        catch {
          for (const text of batch) translations.push(await translateOne(text));
        }
      }
      payload = regenerated.map((chunk, index) => ({ index, startMs: chunk.startMs, endMs: chunk.endMs, sourceText: chunk.sourceText, translation: translations[index] ?? null, speaker: null, sourceKind: "asr", confidence: transcription.confidence, words: chunk.words }));
    } else {
      payload = segments.map((segment) => {
      const { _failed: ignored, ...rest } = segment;
      void ignored;
      return rest;
      });
    }
    const inserted = await sql`insert into media_transcript_backfills (id,media_version_id,media_item_id,source_version,audio_hash,segments,provider,model_version,low_confidence,translation_failed_count,status,created_at,updated_at) values (${randomUUID()},${row.version_id},${row.item_id},${row.version},${source.hash},${JSON.stringify(payload)},${transcription.provider},${transcription.modelVersion},false,0,'draft',now(),now()) on conflict (media_version_id,audio_hash) do nothing returning id`;
    console.log(JSON.stringify({ stableKey, status: inserted.length ? "draft-created" : "duplicate", segments: payload.length, words: payload.reduce((sum, segment) => sum + (segment.words?.length ?? 0), 0) }));
  } finally { await rm(directory, { recursive: true, force: true }); await sql.end(); }
}

main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "WORD_TIMING_FAILED" })); process.exitCode = 1; });
