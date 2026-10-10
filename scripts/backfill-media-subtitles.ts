import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

import { createMiniMaxTranscriptionProvider } from "../src/modules/providers/stt/minimax-transcription";

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
  "sueno-media.b-cdn.net", "content.libsyn.com", "traffic.libsyn.com", "content.blubrry.com",
  "episodes.castos.com", "injector.simplecastaudio.com", "sonoro.simplecastaudio.com",
  "prisa-es.mc.tritondigital.com", "mc.tritondigital.com", "rtve-mediavod-lote3.rtve.es",
  "dcs-cached.megaphone.fm", "dcs-spotify.megaphone.fm", "www.podtrac.com", "dts.podtrac.com",
]);

function allowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || host.endsWith(".mc.tritondigital.com");
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

async function download(url: string, directory: string): Promise<{ path: string; bytes: number; hash: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 6; hop += 1) {
    if (current.protocol !== "https:" || current.username || current.password || !allowedHost(current.hostname)) throw new Error("MEDIA_AUDIO_HOST_NOT_ALLOWED");
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(10 * 60_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("MEDIA_AUDIO_REDIRECT_INVALID");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`MEDIA_AUDIO_HTTP_${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_SOURCE_BYTES) throw new Error("MEDIA_AUDIO_TOO_LARGE");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > MAX_SOURCE_BYTES) throw new Error("MEDIA_AUDIO_TOO_LARGE");
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    const output = path.join(directory, "source.bin");
    await (await import("node:fs/promises")).writeFile(output, bytes);
    return { path: output, bytes: bytes.byteLength, hash: createHash("sha256").update(bytes).digest("hex") };
  }
  throw new Error("MEDIA_AUDIO_TOO_MANY_REDIRECTS");
}

async function refreshLanguageReactorAudio(stableKey: string): Promise<string | null> {
  if (!stableKey.startsWith("podcast.language-reactor.")) return null;
  const docId = stableKey.slice("podcast.language-reactor.".length);
  const response = await fetch("https://api-cdn.dioco.io/base_media_getMediaDocs_5", {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100000 }, lang_G: "es", filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es", diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: docId, offset: 0, limit: 100 }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
  const found = payload.data?.docs_metadata?.find((item) => item.diocoDocId?.toLowerCase() === docId.toLowerCase());
  return found?.audioFileURL ?? null;
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

function sentenceChunks(text: string, durationMs: number): Array<{ startMs: number; endMs: number; text: string }> {
  const values = text.match(/[^.!?。！？]+[.!?。！？]?/gu)?.map((value) => value.trim()).filter(Boolean) ?? [];
  const chunks = values.length ? values : [text.trim()].filter(Boolean);
  return chunks.map((value, index) => ({ startMs: Math.floor(index * durationMs / chunks.length), endMs: index === chunks.length - 1 ? durationMs : Math.max(1, Math.floor((index + 1) * durationMs / chunks.length)), text: value }));
}

async function main() {
  const { stableKey, limit } = args();
  const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const rows = await sql.unsafe(`select i.id as item_id,i.stable_key,i.kind,v.id as version_id,v.version,v.title,v.summary,v.language,v.duration_ms,a.playback_url from media_items i join media_versions v on v.media_item_id=i.id and v.version=i.current_version join media_assets a on a.media_version_id=v.id and a.availability='available' where v.status='published' and v.copyright_status='cleared' and not exists(select 1 from media_segments s where s.media_version_id=v.id) and ($1::text is null or i.stable_key=$1) order by i.kind,i.stable_key limit $2`, [stableKey ?? null, limit]);
  if (!rows.length) { console.log(JSON.stringify({ status: "nothing-to-backfill" })); await sql.end(); return; }
  const transcriber = createMiniMaxTranscriptionProvider();
  const results: unknown[] = [];
  for (const row of rows) {
    const directory = await mkdtemp(path.join(tmpdir(), "sueno-media-backfill-"));
    try {
      const refreshed = await refreshLanguageReactorAudio(String(row.stable_key));
      const source = await download(refreshed ?? String(row.playback_url), directory);
      const normalized = await normalize(source.path, directory);
      const transcription = await transcriber.transcribe({ audioBytes: new Uint8Array(await readFile(normalized.path)), assetPath: normalized.path, mimeType: "audio/mpeg", fileName: "media.mp3", languageTag: "es", durationMs: Number(row.duration_ms) });
      const chunks = sentenceChunks(transcription.text, Number(row.duration_ms));
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
          catch (error) { if (attempt === 3) throw error; await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1))); }
        }
        if (!values || values.length !== end - offset) throw new Error("MEDIA_TRANSLATION_BATCH_SHAPE_INVALID");
        values.forEach((value, index) => { translations[offset + index] = value; });
        offset = end;
      }
      const segments = chunks.map((chunk, index) => ({ index, startMs: chunk.startMs, endMs: chunk.endMs, sourceText: chunk.text, translation: translations[index], speaker: null, confidence: transcription.confidence, sourceKind: "asr" }));
      const inserted = await sql`insert into media_transcript_backfills (id,media_version_id,media_item_id,source_version,audio_hash,segments,provider,model_version,low_confidence,translation_failed_count,status,created_at,updated_at) values (${randomUUID()},${row.version_id},${row.item_id},${row.version},${source.hash},${JSON.stringify(segments)},'minimax',${transcription.modelVersion},false,0,'draft',now(),now()) on conflict (media_version_id,audio_hash) do nothing returning id`;
      results.push({ stableKey: row.stable_key, status: inserted.length ? "draft-created" : "duplicate", segments: segments.length, bytes: normalized.bytes });
    } catch (error) {
      results.push({ stableKey: row.stable_key, status: "failed", code: error instanceof Error ? error.message.split(":", 1)[0] : "MEDIA_BACKFILL_FAILED" });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ results }));
  await sql.end();
}

main().catch((error) => { console.error(JSON.stringify({ status: "failed", code: error instanceof Error ? error.message : "MEDIA_BACKFILL_FAILED" })); process.exitCode = 1; });
