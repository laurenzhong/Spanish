import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { chromium } from "@playwright/test";
import { createBunnyStorageMediaAssetStorage } from "../src/modules/media/storage/bunny-storage";
import { selectYoutubeRecoveryFormats, verifiedVideoDecode } from "../src/modules/media/storage/youtube-recovery-formats";

const root = resolve(".tmp-runtime/youtube-recovered");
const maxBytes = 1024 * 1024 * 1024;
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const ytdlp = process.env.YTDLP_BIN || "yt-dlp";
async function hashFile(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => abort.abort());

function run(command: string, args: string[], outputLimit = 8192, timeoutMs = 20 * 60_000) {
  abort.signal.throwIfAborted();
  return new Promise<string>((done, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let diagnostic = ""; let exceeded = false; let timedOut = false;
    child.stderr.on("data", (bytes: Buffer) => { diagnostic = (diagnostic + bytes.toString()).slice(-16384); });
    child.stdout.on("data", (bytes: Buffer) => {
      output += bytes.toString();
      if (output.length > outputLimit) {
        if (outputLimit > 8192) { exceeded = true; child.kill(); }
        else output = output.slice(-8192);
      }
    });
    const stop = () => { child.kill(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    abort.signal.addEventListener("abort", stop, { once: true });
    const release = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", stop); };
    child.once("error", () => { release(); reject(new Error("MEDIA_COMMAND_UNAVAILABLE")); });
    child.once("close", code => {
      release();
      if (code !== 0 || exceeded || timedOut || abort.signal.aborted) {
        // Never return raw stderr: extractors may include signed media URLs.
        const reason = abort.signal.aborted ? "CANCELLED" : exceeded ? "OUTPUT_LIMIT" : timedOut ? "TIMEOUT"
          : /out of memory|MemoryError|cannot allocate|not enough memory/iu.test(diagnostic) ? "MEMORY_EXHAUSTED"
          : /Sign in to confirm|not a bot/iu.test(diagnostic) ? "MANUAL_SIGNIN_REQUIRED"
          : /Requested format is not available/iu.test(diagnostic) ? "FORMAT_UNAVAILABLE"
          : /challenge solving failed|challenge solver script/iu.test(diagnostic) ? "JS_COMPONENT_FAILED"
          : /HTTP Error: (403|429)/u.test(diagnostic) ? "SOURCE_ACCESS_FAILED"
          : /timed out|connection|network/iu.test(diagnostic) ? "NETWORK_FAILED" : "FAILED";
        reject(new Error(`MEDIA_COMMAND_${reason}`));
      }
      else done(output);
    });
  });
}

async function verifyCdn(url: string, bytes: number, sha: string) {
  const chunkBytes = 8 * 1024 * 1024;
  const verifyTimeoutMs = Number(process.env.MEDIA_CDN_VERIFY_TIMEOUT_MS ?? 15 * 60_000);
  const head = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
  if (!head.ok || Number(head.headers.get("content-length")) !== bytes || !head.headers.get("content-type")?.startsWith("video/mp4")) {
    await head.body?.cancel(); throw new Error("MEDIA_CDN_HEADERS_INVALID");
  }
  const digest = createHash("sha256");
  for (let start = 0; start < bytes; start += chunkBytes) {
    const end = Math.min(bytes - 1, start + chunkBytes - 1);
    const expectedLength = end - start + 1;
    let chunk: Uint8Array | undefined;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { range: `bytes=${start}-${end}` },
          redirect: "error",
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(verifyTimeoutMs)]),
        });
        if (response.status !== 206 || response.headers.get("content-range") !== `bytes ${start}-${end}/${bytes}` || Number(response.headers.get("content-length")) !== expectedLength) {
          await response.body?.cancel();
          throw new Error("MEDIA_CDN_RANGE_INVALID");
        }
        const reader = response.body!.getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        try {
          while (true) {
            const result = await reader.read(); if (result.done) break;
            total += result.value.length;
            if (total > expectedLength) throw new Error("MEDIA_CDN_SIZE_INVALID");
            parts.push(result.value);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (total !== expectedLength) throw new Error("MEDIA_CDN_SIZE_INVALID");
        chunk = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) { chunk.set(part, offset); offset += part.length; }
        break;
      } catch (error) {
        if (attempt === 4) throw new Error("MEDIA_CDN_NETWORK_FAILED", { cause: error });
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(5_000 * attempt, 15_000)));
    }
    if (!chunk) throw new Error("MEDIA_CDN_NETWORK_FAILED");
    digest.update(chunk);
  }
  if (digest.digest("hex") !== sha) throw new Error("MEDIA_CDN_HASH_MISMATCH");
}

async function main() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  const storage = createBunnyStorageMediaAssetStorage();
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!storage || !databaseUrl) throw new Error("MEDIA_CONFIG_REQUIRED");
  await mkdir(root, { recursive: true });
  const lockPath = resolve(root, "recovery.lock"); const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const db = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let migrated = 0; let failed = 0;
  try {
    const rows = await db`select a.id,a.playback_url,i.stable_key,v.version,v.platform_source_id,v.duration_ms from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where i.kind='video' and a.kind='official_embed' and a.provider_key='youtube' and a.availability='available' and v.status='published' and v.copyright_status='cleared' order by i.stable_key`;
    for (const row of rows) {
      if (abort.signal.aborted) break;
      if (process.env.MEDIA_VIDEO_STABLE_KEY && row.stable_key !== process.env.MEDIA_VIDEO_STABLE_KEY) continue;
      const videoId = String(row.platform_source_id);
      if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId) || !/^youtube\.[a-z0-9._-]+$/u.test(row.stable_key) || !/^[a-f0-9-]{36}$/u.test(row.id)) throw new Error("MEDIA_ID_INVALID");
      const directory = resolve(root, videoId); await mkdir(directory, { recursive: true });
      const source = resolve(directory, "source.mp4"); const target = resolve(directory, "playback.mp4");
      const manifestPath = resolve(directory, "migration.json");
      const entry: Record<string, unknown> = { stableKey: row.stable_key, videoId, assetId: row.id, version: row.version, databaseSwitched: false };
      async function record(stage: string) {
        entry.stage = stage; entry.updatedAt = new Date().toISOString();
        await writeFile(`${manifestPath}.new`, JSON.stringify(entry, null, 2)); await rename(`${manifestPath}.new`, manifestPath);
        console.log(JSON.stringify({ stableKey: row.stable_key, stage, error: entry.error }));
      }
      try {
        let previous: Record<string, unknown> = {};
        try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* First attempt. */ }
        await record("extracting-formats");
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        // Keep format extraction on the same native ffmpeg-aware path as the download.
        // Without this, yt-dlp can expose only a SABR fallback (for example 360p),
        // hiding the independent Spanish audio formats needed by the selector.
        const base = ["--ignore-config", "--no-playlist", "--js-runtimes", "node", "--socket-timeout", "30", "--retries", "3", "--ffmpeg-location", ffmpeg];
        // Extractor URLs remain in memory; manifests contain only selected format metadata.
        const metadata = JSON.parse(await run(ytdlp, [...base, "--skip-download", "--dump-single-json", url], 10 * 1024 * 1024, 120_000));
        const selected = selectYoutubeRecoveryFormats(metadata, videoId, Number(row.duration_ms) / 1000);
        entry.formats = selected;
        let reuseSource = false;
        if (previous.assetId === row.id && previous.version === row.version && previous.videoId === videoId && JSON.stringify(previous.formats) === JSON.stringify(selected)) {
          const cached = await stat(source).catch(() => null);
          reuseSource = !!cached && cached.size === previous.sourceBytes && await hashFile(source) === previous.sourceSha;
        }
        if (!reuseSource) {
          await record("downloading");
          await run(ytdlp, [...base, "--no-progress", "--force-overwrites", "--format", selected.selection, "--max-filesize", String(maxBytes), "--merge-output-format", "mp4", "--ffmpeg-location", ffmpeg, "--output", resolve(directory, "source.%(ext)s"), url]);
        }
        const sourceSize = (await stat(source)).size;
        if (sourceSize < 1 || sourceSize > maxBytes) throw new Error("MEDIA_SOURCE_SIZE_INVALID");
        entry.sourceBytes = sourceSize; entry.sourceSha = await hashFile(source);
        await record("validating-source");
        const progress = await run(ffmpeg, ["-v", "error", "-xerror", "-i", source, "-progress", "pipe:1", "-nostats", "-f", "null", "NUL"]);
        const seconds = verifiedVideoDecode(progress, Number(row.duration_ms) / 1000); entry.decodedSeconds = seconds;
        await record("preparing-mp4");
        await run(ffmpeg, ["-v", "error", "-xerror", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c:v", selected.videoCodec.startsWith("avc1") ? "copy" : "libx264", ...(!selected.videoCodec.startsWith("avc1") ? ["-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"] : []), "-c:a", selected.audioCodec.startsWith("mp4a") ? "copy" : "aac", "-movflags", "+faststart", target]);
        verifiedVideoDecode(await run(ffmpeg, ["-v", "error", "-xerror", "-i", target, "-progress", "pipe:1", "-nostats", "-f", "null", "NUL"]), seconds);
        const size = (await stat(target)).size; if (size < 1 || size > maxBytes) throw new Error("MEDIA_TARGET_SIZE_INVALID");
        const sha = await hashFile(target);
        const path = `media/${row.stable_key}/${row.version}/video-${sha}.mp4`;
        const targetUrl = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/${path}`;
        entry.targetBytes = size; entry.targetSha = sha; entry.targetUrl = targetUrl;
        let exists = false;
        if (previous.targetSha === sha && previous.targetUrl === targetUrl) {
          try { await verifyCdn(targetUrl, size, sha); exists = true; } catch { /* Retry exact content-addressed upload. */ }
        }
        if (!exists) {
          await record("uploading");
          const result = storage.putVideoFromFile
            ? await storage.putVideoFromFile(path, target)
            : await storage.putVideo(path, await readFile(target), "video/mp4");
          if (result.url !== targetUrl) throw new Error("MEDIA_TARGET_INVALID");
        }
        await record("verifying-cdn"); await verifyCdn(targetUrl, size, sha);
        await record("verifying-playback");
        browser ??= await chromium.launch({ channel: "chrome", headless: true });
        const page = await browser.newPage();
        try {
          await page.setContent('<video muted controls></video>');
          await page.locator("video").evaluate((v: HTMLVideoElement, url) => { v.src = url; v.play().catch(() => undefined); }, targetUrl);
          await page.waitForFunction(() => document.querySelector("video")!.currentTime > 2, undefined, { timeout: 60_000 });
          const samples = [];
          for (const position of [Math.floor(seconds / 2), seconds - 5]) {
            await page.locator("video").evaluate((v: HTMLVideoElement, t) => { v.currentTime = t; }, position);
            await page.waitForFunction(t => document.querySelector("video")!.currentTime > t + 1, position, { timeout: 45_000 });
            samples.push(await page.locator("video").evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, duration: v.duration, width: v.videoWidth, height: v.videoHeight, readyState: v.readyState, error: v.error?.code ?? null })));
          }
          if (samples.some(s => s.error || s.readyState < 3 || s.width !== selected.width || s.height !== selected.height || Math.abs(s.duration - seconds) > 2)) throw new Error("MEDIA_PLAYBACK_INVALID");
          entry.playback = samples;
        } finally { await page.close(); }
        abort.signal.throwIfAborted(); await record("verified");
        await db.begin(async tx => {
          const current = await tx`select a.id from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where a.id=${row.id} and i.stable_key=${row.stable_key} and v.version=${row.version} and v.platform_source_id=${videoId} and a.kind='official_embed' and a.provider_key='youtube' and a.playback_url=${row.playback_url} and a.availability='available' and v.status='published' and v.copyright_status='cleared' for update of a,v,i`;
          if (current.length !== 1) throw new Error("MEDIA_ASSET_CHANGED");
          await tx`update media_assets set kind='video',provider_key='bunny-storage',playback_url=${targetUrl},playback_expires_at=null,mime_type='video/mp4',updated_at=now() where id=${row.id}`;
        });
        entry.databaseSwitched = true; await record("switched"); migrated++;
      } catch (error) {
        failed++; entry.failedStage = entry.stage;
        entry.error = error instanceof Error && /^(MEDIA_|bunny-storage-)[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : error instanceof Error && error.name === "TimeoutError" ? "MEDIA_OPERATION_TIMEOUT" : "MEDIA_RECOVERY_FAILED";
        await record("failed");
      }
    }
    console.log(JSON.stringify({ migrated, failed, cancelled: abort.signal.aborted, sourceDeletions: 0 }));
    if (failed || abort.signal.aborted) process.exitCode = 1;
  } finally { await browser?.close(); await db.end(); await lock.close(); await rm(lockPath); }
}
main().catch(() => { console.error("MEDIA_RECOVERY_CONFIG_OR_LOCK_FAILED"); process.exitCode = 1; });
