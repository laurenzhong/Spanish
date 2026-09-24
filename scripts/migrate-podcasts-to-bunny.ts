import "dotenv/config";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { chromium } from "@playwright/test";
import { z } from "zod";
import { createBunnyStorageMediaAssetStorage } from "../src/modules/media/storage/bunny-storage";
import { verifiedDecodedAudioDuration } from "../src/modules/media/storage/audio-integrity";
import { downloadResumableAudio } from "../src/modules/media/storage/resumable-audio-download";

const root = resolve(".tmp-runtime/bunny-podcast-migration");
const maxBytes = 512 * 1024 * 1024;
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const allowed = new Set([
  "content.libsyn.com", "traffic.libsyn.com", "traffic.megaphone.fm", "dcs-spotify.megaphone.fm", "dcs-cached.megaphone.fm",
  "ztnr.rtve.es", "rtve-mediavod-lote3.rtve.es", "content.blubrry.com", "episodes.castos.com",
  "injector.simplecastaudio.com", "sonoro.simplecastaudio.com",
]);

async function refreshPodcastSource(stableKey: string) {
  const docId = stableKey.slice("podcast.language-reactor.".length);
  const response = await fetch("https://api-cdn.dioco.io/base_media_getMediaDocs_5", {
    method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100000 }, lang_G: "es", filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es", diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: docId, offset: 0, limit: 100 }),
  });
  if (!response.ok) throw new Error("AUDIO_SOURCE_REFRESH_FAILED");
  const body = z.object({ data: z.object({ docs_metadata: z.array(z.object({ diocoDocId: z.string(), audioFileURL: z.string().optional() })) }) }).parse(await response.json());
  const document = body.data.docs_metadata.find((d) => d.diocoDocId.toLowerCase() === docId);
  if (!document?.audioFileURL) throw new Error("AUDIO_SOURCE_REFRESH_FAILED");
  return new URL(document.audioFileURL);
}

async function download(source: string) {
  let url = new URL(source);
  for (let hop = 0; hop < 5; hop++) {
    if (url.protocol !== "https:" || url.username || url.password || !allowed.has(url.hostname)) throw new Error("AUDIO_SOURCE_NOT_ALLOWED");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(300_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("AUDIO_REDIRECT_INVALID");
      url = new URL(location, url); continue;
    }
    const length = Number(response.headers.get("content-length"));
    const type = response.headers.get("content-type")?.split(";")[0].toLowerCase();
    if (response.status !== 200 || !response.body || !["audio/mpeg", "audio/mp3"].includes(type ?? "") || !Number.isSafeInteger(length) || length < 1 || length > maxBytes) {
      await response.body?.cancel(); throw new Error("AUDIO_RESPONSE_INVALID");
    }
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > length || size > maxBytes) throw new Error("AUDIO_SIZE_INVALID");
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (size !== length) throw new Error("AUDIO_DOWNLOAD_INCOMPLETE");
    return Buffer.concat(chunks);
  }
  throw new Error("AUDIO_TOO_MANY_REDIRECTS");
}

async function decode(path: string, expectedDurationSeconds: number) {
  return new Promise<void>((done, reject) => {
    const child = spawn(process.env.FFMPEG_BIN || "ffmpeg", ["-v", "error", "-xerror", "-i", path, "-progress", "pipe:1", "-nostats", "-f", "null", "NUL"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let progress = "";
    child.stdout.on("data", (chunk: Buffer) => { progress = (progress + chunk.toString()).slice(-4096); });
    const timeout = setTimeout(() => { child.kill(); }, 10 * 60_000);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("AUDIO_DECODER_UNAVAILABLE")); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !progress.includes("progress=end")) return reject(new Error("AUDIO_DECODE_FAILED"));
      try { verifiedDecodedAudioDuration(progress, expectedDurationSeconds); } catch (error) { reject(error); return; }
      done();
    });
  });
}

async function downloadWithCurl(source: string, directory: string) {
  const headerFile = resolve(directory, "download.headers");
  const bodyFile = resolve(directory, "download.part");
  let url = new URL(source);
  try {
    for (let hop = 0; hop < 5; hop++) {
      if (url.protocol !== "https:" || url.username || url.password || !allowed.has(url.hostname)) throw new Error("AUDIO_SOURCE_NOT_ALLOWED");
      await new Promise<void>((done, reject) => {
        const child = spawn("curl.exe", ["-4", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "180", "--retry", "1", "--max-filesize", String(maxBytes), "--dump-header", headerFile, "--output", bodyFile, url.toString()], { windowsHide: true, stdio: "ignore" });
        const timer = setTimeout(() => child.kill(), 390_000);
        child.once("error", () => { clearTimeout(timer); reject(new Error("AUDIO_CURL_UNAVAILABLE")); });
        child.once("close", (code) => { clearTimeout(timer); if (code === 0) done(); else reject(new Error("AUDIO_CURL_FAILED")); });
      });
      const { finalMediaHeaders } = await import("../src/modules/media/storage/hosted-video-integrity");
      const { status, headers } = finalMediaHeaders(await readFile(headerFile, "utf8"));
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = headers.get("location"); if (!location) throw new Error("AUDIO_REDIRECT_INVALID");
        url = new URL(location, url); continue;
      }
      const length = Number(headers.get("content-length"));
      if (status !== 200 || !["audio/mpeg", "audio/mp3"].includes(headers.get("content-type")?.split(";")[0].toLowerCase() ?? "") || !Number.isSafeInteger(length) || length < 1 || length > maxBytes) throw new Error("AUDIO_RESPONSE_INVALID");
      const data = await readFile(bodyFile);
      if (data.length !== length) throw new Error("AUDIO_DOWNLOAD_INCOMPLETE");
      return data;
    }
    throw new Error("AUDIO_TOO_MANY_REDIRECTS");
  } finally {
    await rm(headerFile, { force: true }); await rm(bodyFile, { force: true });
  }
}

async function main() {
  if (process.env.MEDIA_AUDIO_HOSTING_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("AUDIO_AUTHORIZATION_REQUIRED");
  const storage = createBunnyStorageMediaAssetStorage();
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!storage || !databaseUrl || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME) throw new Error("AUDIO_CONFIG_REQUIRED");
  allowed.add(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname);
  allowed.add(process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME);
  await mkdir(root, { recursive: true });
  const lockPath = resolve(root, "migration.lock");
  const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const client = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let migrated = 0; let failed = 0;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const rows = await client`select a.id,a.playback_url,a.provider_key,i.stable_key,v.version,v.duration_ms from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where i.kind='podcast' and i.stable_key like 'podcast.language-reactor.%' and a.kind='audio' and a.provider_key in ('language-reactor','supabase-storage:media-audio') and a.availability='available' and v.status='published' and v.copyright_status='cleared' and not exists (select 1 from media_segments s where s.media_version_id=v.id) order by i.stable_key`;
    for (const row of rows) {
      if (!/^[a-f0-9-]{36}$/u.test(row.id) || !/^podcast\.language-reactor\.[a-z0-9._-]+$/u.test(row.stable_key)) throw new Error("AUDIO_ID_INVALID");
      const directory = resolve(root, row.id); await mkdir(directory, { recursive: true });
      const manifestPath = resolve(directory, "manifest.json");
      const local = resolve(directory, "audio.mp3");
      const entry = {
        assetId: String(row.id), stableKey: String(row.stable_key), version: Number(row.version), sourceUrlHash: hash(row.playback_url),
        sourceProvider: String(row.provider_key), sha256: "", bytes: 0, targetUrl: "", stage: "started", databaseSwitched: false, sourceDeleted: false,
        playback: null as null | { duration: number; currentTime: number; readyState: number; error: number | null }, error: null as string | null,
      };
      async function record(stage: string) {
        entry.stage = stage;
        await writeFile(`${manifestPath}.new`, JSON.stringify(entry,null,2)); await rename(`${manifestPath}.new`, manifestPath);
        console.log(JSON.stringify({ stableKey: entry.stableKey, stage, error: entry.error }));
      }
      try {
        let data: Buffer | null = null;
        try {
          const previous = JSON.parse(await readFile(manifestPath,"utf8"));
          const cached = await readFile(local);
          if (previous.assetId === entry.assetId && previous.sourceUrlHash === entry.sourceUrlHash && previous.bytes === cached.length && previous.sha256 === hash(cached)) data = cached;
        } catch { /* no reusable exact source */ }
        await record("downloading");
        if (!data) {
          let source = new URL(row.playback_url);
          if (row.provider_key === "language-reactor") {
            try { source = await refreshPodcastSource(entry.stableKey); } catch { /* Use the still-authorized stored enclosure once. */ }
          }
          if (row.provider_key === "language-reactor") {
            data = await downloadResumableAudio({
              source: async () => source, directory, allowedHosts: allowed, maxBytes,
              progress: (bytes, total) => console.log(JSON.stringify({ stage: "audio-range-downloaded", bytes, total })),
            });
          } else {
            try { data = await download(source.toString()); }
            catch { data = await downloadWithCurl(source.toString(), directory); }
          }
          await writeFile(local, data);
        }
        entry.sha256 = hash(data); entry.bytes = data.length;
        const path = `media/${entry.stableKey}/${entry.version}/audio-${entry.sha256}.mp3`;
        entry.targetUrl = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/${path}`;
        await record("validating-source"); await decode(local, Number(row.duration_ms) / 1000);
        let alreadyUploaded = false;
        try { const existing = await download(entry.targetUrl); alreadyUploaded = existing.length === entry.bytes && hash(existing) === entry.sha256; } catch { /* upload exact hashed bytes */ }
        if (!alreadyUploaded) { await record("uploading"); const uploaded = await storage.putAudio(path, data, "audio/mpeg"); if (uploaded.url !== entry.targetUrl) throw new Error("AUDIO_TARGET_INVALID"); }
        await record("verifying-cdn");
        const delivered = await download(entry.targetUrl);
        if (delivered.length !== entry.bytes || hash(delivered) !== entry.sha256) throw new Error("AUDIO_CDN_HASH_MISMATCH");
        await record("verifying-playback");
        const page = await browser.newPage();
        try {
          await page.setContent('<audio controls muted></audio>');
          await page.locator("audio").evaluate(async (audio: HTMLAudioElement, url) => { audio.src = url; await audio.play(); }, entry.targetUrl);
          await page.waitForFunction(() => document.querySelector("audio")!.currentTime > 1, undefined, { timeout: 45000 });
          const seek = await page.locator("audio").evaluate((audio: HTMLAudioElement) => { audio.currentTime = audio.duration - 5; return audio.currentTime; });
          await page.waitForFunction((seconds) => document.querySelector("audio")!.currentTime > seconds + 1, seek, { timeout: 45000 });
          entry.playback = await page.locator("audio").evaluate((audio: HTMLAudioElement) => ({ duration: audio.duration, currentTime: audio.currentTime, readyState: audio.readyState, error: audio.error?.code ?? null }));
          if (entry.playback.error || entry.playback.readyState < 3 || Math.abs(entry.playback.duration - Number(row.duration_ms) / 1000) > 5) throw new Error("AUDIO_PLAYBACK_DURATION_MISMATCH");
        } finally { await page.close(); }
        await record("verified");
        await client.begin(async (tx) => {
          const current = await tx`select a.id from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where a.id=${entry.assetId} and a.playback_url=${row.playback_url} and a.provider_key=${row.provider_key} and a.availability='available' and v.status='published' and v.copyright_status='cleared' for update of a,v,i`;
          if (current.length !== 1) throw new Error("AUDIO_ASSET_CHANGED");
          await tx`update media_assets set provider_key='bunny-storage', playback_url=${entry.targetUrl}, playback_expires_at=null, mime_type='audio/mpeg',updated_at=now() where id=${entry.assetId}`;
        });
        entry.databaseSwitched = true; await record("switched"); migrated++;
        await rm(local);
      } catch (error) {
        failed++; entry.error = error instanceof Error && /^(AUDIO_|bunny-storage-)[A-Za-z0-9_-]+$/u.test(error.message) ? error.message : "AUDIO_MIGRATION_FAILED";
        await record("failed");
      }
    }
    console.log(JSON.stringify({ migrated, failed, sourceDeletions: 0 })); if (failed) process.exitCode = 1;
  } finally { await browser?.close(); await client.end(); await lock.close(); await rm(lockPath); }
}
main().catch(() => { console.error("AUDIO_MIGRATION_CONFIG_OR_LOCK_FAILED"); process.exitCode = 1; });
