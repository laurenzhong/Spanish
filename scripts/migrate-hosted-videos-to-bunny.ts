import "dotenv/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import postgres from "postgres";
import { createBunnyStorageMediaAssetStorage } from "../src/modules/media/storage/bunny-storage";
import { finalMediaHeaders, validateHostedSource, validateMediaRange } from "../src/modules/media/storage/hosted-video-integrity";

// Owner-only operational migration. No discovery, publishing, ASR or source deletion.
const root = resolve(".tmp-runtime/bunny-hosted-migration");
const maxBytes = Number(process.env.MEDIA_VIDEO_MAX_BYTES ?? 512 * 1024 * 1024);
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const limit = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 100);
const cancelled = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => cancelled.abort());

function run(command: string, args: string[], timeout = 15 * 60_000, allowFailure = false): Promise<string> {
  cancelled.signal.throwIfAborted();
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let output = "";
    let timedOut = false;
    child.stderr.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_000); });
    const stop = () => { child.kill(); };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
    cancelled.signal.addEventListener("abort", stop, { once: true });
    function release() { clearTimeout(timer); cancelled.signal.removeEventListener("abort", stop); }
    child.once("error", () => { release(); reject(new Error("MEDIA_COMMAND_UNAVAILABLE")); });
    child.once("close", (code) => {
      release();
      if (cancelled.signal.aborted) return reject(new Error("MEDIA_CANCELLED"));
      if (timedOut) return reject(new Error("MEDIA_COMMAND_TIMEOUT"));
      if (code !== 0 && !allowFailure) return reject(new Error("MEDIA_COMMAND_FAILED"));
      done(output);
    });
  });
}

async function download(url: string, path: string) {
  const headerPath = `${path}.headers`;
  await run("curl.exe", ["-4", "--fail", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "45", "--retry", "2", "--head", "--output", headerPath, url], 180_000);
  const response = finalMediaHeaders(await readFile(headerPath, "utf8"));
  const total = Number(response.headers.get("content-length"));
  if (response.status !== 200 || !Number.isSafeInteger(total) || total < 1 || total > maxBytes) throw new Error("MEDIA_SOURCE_SIZE_INVALID");
  if (!response.headers.get("content-type")?.startsWith("video/mp4")) throw new Error("MEDIA_MIME_INVALID");
  const etag = response.headers.get("etag");
  await writeFile(path, new Uint8Array());
  for (let start = 0; start < total; start += 2 * 1024 * 1024) {
    const end = Math.min(total - 1, start + 2 * 1024 * 1024 - 1);
    const part = `${path}.part`;
    await run("curl.exe", ["-4", "--fail", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "60", "--retry", "2", "--max-filesize", String(end - start + 1), "--range", `${start}-${end}`, ...(etag ? ["--header", `If-Match: ${etag}`] : []), "--dump-header", headerPath, "--output", part, url], 240_000);
    const data = await readFile(part);
    const raw = await readFile(headerPath, "utf8");
    validateMediaRange(raw, start, end, total, data.length);
    const returnedEtag = finalMediaHeaders(raw).headers.get("etag");
    if (etag && returnedEtag && etag !== returnedEtag) throw new Error("MEDIA_SOURCE_CHANGED");
    await appendFile(path, data);
    await rm(part);
  }
  await rm(headerPath);
  if ((await stat(path)).size !== total) throw new Error("MEDIA_DOWNLOAD_INCOMPLETE");
  return total;
}

async function duration(path: string) {
  const info = await run(ffmpeg, ["-hide_banner", "-i", path], 30_000, true);
  const match = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(info);
  if (!match) throw new Error("MEDIA_DURATION_UNKNOWN");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

type Entry = {
  assetId: string; stableKey: string; version: number; sourceUrl: string;
  stage: string; sourceBytes?: number; sourceSha256?: string; sourceDuration?: number;
  targetPath?: string; targetUrl?: string; targetBytes?: number; targetSha256?: string;
  playback?: { duration: number; position: number; readyState: number; error: number | null };
  databaseSwitched?: boolean; sourceDeleted: false; error?: string; updatedAt: string;
};

async function main() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("MEDIA_LIMIT_INVALID");
  const storage = createBunnyStorageMediaAssetStorage();
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!storage || !databaseUrl || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("MEDIA_CONFIG_REQUIRED");
  await mkdir(root, { recursive: true });
  // Exclusive lock: if a process crashes, inspect its PID before manually clearing it.
  const lockPath = resolve(root, "migration.lock");
  const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const client = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let migrated = 0;
  let failed = 0;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const rows = await client`select a.id as asset_id, a.playback_url as source_url, i.stable_key, v.version from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where i.kind='video' and v.status='published' and v.copyright_status='cleared' and a.kind='video' and a.provider_key='supabase-storage:media-video' and a.availability='available' order by i.stable_key`;
    for (const row of rows.slice(0, limit)) {
      if (cancelled.signal.aborted) break;
      if (process.env.MEDIA_VIDEO_STABLE_KEY && row.stable_key !== process.env.MEDIA_VIDEO_STABLE_KEY) continue;
      const assetId = String(row.asset_id);
      if (!/^[a-f0-9-]{36}$/u.test(assetId) || !/^youtube\.[a-z0-9._-]{1,200}$/u.test(row.stable_key)) throw new Error("MEDIA_ID_INVALID");
      validateHostedSource(row.source_url, process.env.NEXT_PUBLIC_SUPABASE_URL);
      const directory = resolve(root, assetId);
      await mkdir(directory, { recursive: true });
      const manifestPath = resolve(directory, "manifest.json");
      const entry: Entry = { assetId, stableKey: row.stable_key, version: row.version, sourceUrl: row.source_url, stage: "started", sourceDeleted: false, updatedAt: new Date().toISOString() };
      const record = async (stage: string) => {
        entry.stage = stage; entry.updatedAt = new Date().toISOString();
        await writeFile(`${manifestPath}.new`, JSON.stringify(entry, null, 2) + "\n");
        await rename(`${manifestPath}.new`, manifestPath);
        console.log(JSON.stringify({ stableKey: entry.stableKey, stage }));
      };
      const source = resolve(directory, "source.mp4");
      const target = resolve(directory, "h264.mp4");
      const cdn = resolve(directory, "cdn.mp4");
      try {
        // Resume only an exact prior candidate; never trust a prior verification flag.
        let previous: Entry | undefined;
        try { previous = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* first attempt */ }
        const reusable = previous?.sourceUrl === entry.sourceUrl && previous.assetId === entry.assetId && previous.version === entry.version && previous.targetPath && previous.targetSha256 && previous.sourceDuration;
        if (reusable) {
          const data = await readFile(target).catch(() => null);
          if (data && createHash("sha256").update(data).digest("hex") === previous!.targetSha256) Object.assign(entry, previous, { error: undefined, databaseSwitched: false });
        }
        if (!entry.targetSha256) {
          await record("downloading");
          const cachedSource = previous?.sourceUrl === entry.sourceUrl && previous.assetId === entry.assetId && previous.sourceSha256
            ? await readFile(source).catch(() => null) : null;
          if (cachedSource && cachedSource.length === previous!.sourceBytes && createHash("sha256").update(cachedSource).digest("hex") === previous!.sourceSha256) {
            entry.sourceBytes = cachedSource.length;
          } else {
            entry.sourceBytes = await download(entry.sourceUrl, source);
          }
          entry.sourceSha256 = createHash("sha256").update(await readFile(source)).digest("hex");
          entry.sourceDuration = await duration(source);
          await record("validating-source");
          await run(ffmpeg, ["-v", "error", "-xerror", "-i", source, "-f", "null", "NUL"]);
          await record("transcoding");
          await run(ffmpeg, ["-v", "error", "-xerror", "-y", "-i", source, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", target]);
          await run(ffmpeg, ["-v", "error", "-xerror", "-i", target, "-f", "null", "NUL"]);
          const targetDuration = await duration(target);
          if (Math.abs(targetDuration - entry.sourceDuration) > 0.5) throw new Error("MEDIA_DURATION_MISMATCH");
          entry.targetBytes = (await stat(target)).size;
          if (entry.targetBytes > maxBytes || entry.targetBytes < 1) throw new Error("MEDIA_OUTPUT_SIZE_INVALID");
          entry.targetSha256 = createHash("sha256").update(await readFile(target)).digest("hex");
          entry.targetPath = `media/${entry.stableKey}/${entry.version}/video-${entry.targetSha256}.mp4`;
          entry.targetUrl = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/${entry.targetPath}`;
          await record("prepared");
        }
        const expectedPath = `media/${entry.stableKey}/${entry.version}/video-${entry.targetSha256}.mp4`;
        const expectedUrl = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/${expectedPath}`;
        if (entry.targetPath !== expectedPath || entry.targetUrl !== expectedUrl) throw new Error("MEDIA_MANIFEST_TARGET_INVALID");
        let cdnMatches = false;
        // Reuse an uploaded object on retry, including a previous upload timeout.
        if (reusable) {
          try { await download(expectedUrl, cdn); cdnMatches = createHash("sha256").update(await readFile(cdn)).digest("hex") === entry.targetSha256; } catch { /* upload below */ }
        }
        if (!cdnMatches) {
          await record("uploading");
          const result = await storage.putVideo(expectedPath, await readFile(target), "video/mp4");
          if (result.url !== expectedUrl) throw new Error("MEDIA_TARGET_URL_INVALID");
          await record("verifying-cdn");
          await download(expectedUrl, cdn);
          if ((await stat(cdn)).size !== entry.targetBytes || createHash("sha256").update(await readFile(cdn)).digest("hex") !== entry.targetSha256) throw new Error("MEDIA_CDN_HASH_MISMATCH");
        }
        await record("verifying-playback");
        const page = await browser.newPage();
        try {
          await page.setContent('<video controls muted></video>');
          await page.locator("video").evaluate(async (video: HTMLVideoElement, url) => { video.src = url; await video.play(); }, expectedUrl);
          await page.waitForFunction(() => document.querySelector("video")!.currentTime > 1, undefined, { timeout: 45_000 });
          const seek = Math.max(0, entry.sourceDuration! - 5);
          await page.locator("video").evaluate((video: HTMLVideoElement, seconds) => { video.currentTime = seconds; }, seek);
          await page.waitForFunction((seconds) => document.querySelector("video")!.currentTime > seconds + 1, seek, { timeout: 45_000 });
          entry.playback = await page.locator("video").evaluate((video: HTMLVideoElement) => ({ duration: video.duration, position: video.currentTime, readyState: video.readyState, error: video.error?.code ?? null }));
          if (entry.playback.error || entry.playback.readyState < 3 || Math.abs(entry.playback.duration - entry.sourceDuration!) > 0.5) throw new Error("MEDIA_PLAYBACK_INVALID");
        } finally { await page.close(); }
        cancelled.signal.throwIfAborted();
        await record("verified");
        await client.begin(async (tx) => {
          const current = await tx`select a.id from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where a.id=${assetId} and a.provider_key='supabase-storage:media-video' and a.playback_url=${entry.sourceUrl} and a.availability='available' and v.status='published' and v.copyright_status='cleared' for update of a,v,i`;
          if (current.length !== 1) throw new Error("MEDIA_ASSET_CHANGED");
          await tx`update media_assets set provider_key='bunny-storage', playback_url=${expectedUrl}, playback_expires_at=null, updated_at=now() where id=${assetId}`;
        });
        entry.databaseSwitched = true;
        await record("switched");
        migrated++;
        // Only our exact disposable copies; retain audit manifest and remote original.
        for (const file of [source, target, cdn]) await rm(file, { force: true });
      } catch (error) {
        failed++;
        entry.error = error instanceof Error && /^(MEDIA_|bunny-storage-)[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : "MEDIA_MIGRATION_FAILED";
        await record("failed");
        console.log(JSON.stringify({ stableKey: entry.stableKey, error: entry.error }));
      }
    }
    console.log(JSON.stringify({ migrated, failed, cancelled: cancelled.signal.aborted, sourceDeletions: 0 }));
    if (failed || cancelled.signal.aborted) process.exitCode = 1;
  } finally {
    await browser?.close();
    await client.end();
    await lock.close();
    await rm(lockPath);
  }
}
main().catch(() => { console.error("MEDIA_MIGRATION_STOPPED_CHECK_CONFIG_OR_LOCK"); process.exitCode = 1; });
