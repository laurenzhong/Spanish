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
import { classifyYoutubeRecoveryFailure } from "../src/modules/media/storage/youtube-recovery-failure";

const root = resolve(".tmp-runtime/youtube-recovered");
const maxBytes = Number(process.env.MEDIA_VIDEO_RECOVERY_MAX_BYTES ?? 1024 * 1024 * 1024);
const maxOutputHeight = process.env.MEDIA_VIDEO_MAX_OUTPUT_HEIGHT ? Number(process.env.MEDIA_VIDEO_MAX_OUTPUT_HEIGHT) : null;
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";
const ytdlp = process.env.YTDLP_BIN || "yt-dlp";
const cookiesFile = process.env.MEDIA_VIDEO_COOKIES_FILE?.trim() || null;

function getYoutubeRecoveryUrl(playbackUrl: string, videoId: string): string {
  let parsed: URL;
  try { parsed = new URL(playbackUrl); } catch { throw new Error("MEDIA_PLAYBACK_URL_INVALID"); }
  if (!/^(?:www\.)?youtube(?:-nocookie)?\.com$/u.test(parsed.hostname) || parsed.pathname !== `/embed/${videoId}`) {
    throw new Error("MEDIA_PLAYBACK_URL_INVALID");
  }
  // Keep the source URL on the provider's embed path. In this environment the
  // watch endpoint is not reliably reachable, while the stored embed URL is.
  return parsed.toString();
}
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
        const reason = classifyYoutubeRecoveryFailure({ diagnostic, code, exceededOutput: exceeded, timedOut, aborted: abort.signal.aborted });
        reject(new Error(`MEDIA_COMMAND_${reason}`));
      }
      else done(output);
    });
  });
}

async function archiveUnhostableYoutubeVideo(
  db: postgres.Sql,
  row: Readonly<{ id: string; stable_key: string; version: number }>,
  archivedAt: Date,
): Promise<boolean> {
  return db.begin(async (tx) => {
    const current = await tx`
      select a.id, v.id as version_id, v.acquisition_candidate_id, i.id as item_id, i.current_version
      from media_assets a
      join media_versions v on v.id=a.media_version_id
      join media_items i on i.id=v.media_item_id and i.current_version=v.version
      where a.id=${row.id} and i.stable_key=${row.stable_key} and v.version=${row.version}
        and a.kind='official_embed' and a.provider_key='youtube' and a.availability='available'
        and v.status='published' and v.copyright_status='cleared'
      for update of a, v, i
    `;
    if (current.length !== 1) return false;
    const item = current[0];
    await tx`update media_versions set status='archived', updated_at=${archivedAt} where id=${item.version_id} and status='published'`;
    await tx`update media_assets set availability='withdrawn', updated_at=${archivedAt} where id=${item.id} and availability='available'`;
    await tx`update media_items set current_version=null, updated_at=${archivedAt} where id=${item.item_id} and current_version=${row.version}`;
    if (item.acquisition_candidate_id) {
      await tx`
        update content_candidates
        set publication_status='archived', archived_at=${archivedAt}, last_activity_at=${archivedAt}, updated_at=${archivedAt}
        where id=${item.acquisition_candidate_id} and publication_status='published'
      `;
    }
    return true;
  }) as unknown as Promise<boolean>;
}

async function verifyCdn(url: string, bytes: number, sha: string) {
  const chunkBytes = 8 * 1024 * 1024;
  const concurrentChunks = 4;
  const verifyTimeoutMs = Number(process.env.MEDIA_CDN_VERIFY_TIMEOUT_MS ?? 15 * 60_000);
  const head = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60_000)]) });
  if (!head.ok || Number(head.headers.get("content-length")) !== bytes || !head.headers.get("content-type")?.startsWith("video/mp4")) {
    await head.body?.cancel(); throw new Error("MEDIA_CDN_HEADERS_INVALID");
  }
  const digest = createHash("sha256");
  async function readRange(start: number, end: number): Promise<Uint8Array> {
    const expectedLength = end - start + 1;
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
        const chunk = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) { chunk.set(part, offset); offset += part.length; }
        return chunk;
      } catch (error) {
        if (attempt === 4) throw new Error("MEDIA_CDN_NETWORK_FAILED", { cause: error });
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(5_000 * attempt, 15_000)));
    }
    throw new Error("MEDIA_CDN_NETWORK_FAILED");
  }
  const ranges = Array.from({ length: Math.ceil(bytes / chunkBytes) }, (_, index) => {
    const start = index * chunkBytes;
    return [start, Math.min(bytes - 1, start + chunkBytes - 1)] as const;
  });
  for (let offset = 0; offset < ranges.length; offset += concurrentChunks) {
    const chunks = await Promise.all(ranges.slice(offset, offset + concurrentChunks).map(([start, end]) => readRange(start, end)));
    for (const chunk of chunks) digest.update(chunk);
  }
  if (digest.digest("hex") !== sha) throw new Error("MEDIA_CDN_HASH_MISMATCH");
}

async function main() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || (maxOutputHeight !== null && (!Number.isSafeInteger(maxOutputHeight) || maxOutputHeight < 2))) throw new Error("MEDIA_CONFIG_REQUIRED");
  const storage = createBunnyStorageMediaAssetStorage();
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!storage || !databaseUrl) throw new Error("MEDIA_CONFIG_REQUIRED");
  await mkdir(root, { recursive: true });
  const lockPath = resolve(root, "recovery.lock"); const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const db = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let migrated = 0; let failed = 0; let excluded = 0;
  try {
    const rows = await db`select a.id,a.playback_url,i.stable_key,v.version,v.platform_source_id,v.duration_ms,v.language from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where i.kind='video' and a.kind='official_embed' and a.provider_key='youtube' and a.availability='available' and v.status='published' and v.copyright_status='cleared' order by i.stable_key`;
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
        const url = getYoutubeRecoveryUrl(String(row.playback_url), videoId);
        // Keep format extraction on the same native ffmpeg-aware path as the download.
        // Without this, yt-dlp can expose only a SABR fallback (for example 360p),
        // hiding the independent Spanish audio formats needed by the selector.
        const base = ["--ignore-config", "--no-playlist", "--js-runtimes", "node", "--force-ipv4", "--socket-timeout", "30", "--retries", "3", "--ffmpeg-location", ffmpeg, ...(cookiesFile ? ["--cookies", cookiesFile] : [])];
        // Extractor URLs remain in memory; manifests contain only selected format metadata.
        const metadata = JSON.parse(await run(ytdlp, [...base, "--skip-download", "--dump-single-json", url], 10 * 1024 * 1024, 120_000));
        const selected = selectYoutubeRecoveryFormats(metadata, videoId, Number(row.duration_ms) / 1000, String(row.language) === "es");
        entry.formats = selected;
        let reuseSource = false;
        const previousSelection = previous.formats as Record<string, unknown> | undefined;
        const sameSelection = previousSelection?.selection === selected.selection
          && previousSelection.width === selected.width
          && previousSelection.height === selected.height
          && previousSelection.videoCodec === selected.videoCodec
          && previousSelection.audioCodec === selected.audioCodec
          && previousSelection.duration === selected.duration;
        if (previous.assetId === row.id && previous.version === row.version && previous.videoId === videoId && sameSelection) {
          const cached = await stat(source).catch(() => null);
          const previousSize = Number(previous.sourceBytes);
          const cachedMatchesManifest = Number.isSafeInteger(previousSize) && previousSize > 0 && cached?.size === previousSize && await hashFile(source) === previous.sourceSha;
          const cachedWasRejectedOnlyForSize = previous.error === "MEDIA_SOURCE_SIZE_INVALID" && !!cached && cached.size <= maxBytes;
          // yt-dlp may finish the separate video/audio downloads before a
          // process is interrupted during its merge step. Reuse that
          // content-addressed local MP4 after the merge has been completed by
          // an operator; the full decode and duration gates below still run.
          const cachedAfterDownloadFailure = previous.failedStage === "downloading" && !!cached && cached.size <= maxBytes;
          reuseSource = cachedMatchesManifest || cachedWasRejectedOnlyForSize || cachedAfterDownloadFailure;
        }
        if (!reuseSource) {
          await record("downloading");
          await run(ytdlp, [...base, "--no-progress", "--force-overwrites", "--format", selected.selection, "--max-filesize", String(maxBytes), "--merge-output-format", "mp4", "--ffmpeg-location", ffmpeg, "--output", resolve(directory, "source.mp4"), url]);
        }
        const sourceSize = (await stat(source)).size;
        if (sourceSize < 1 || sourceSize > maxBytes) throw new Error("MEDIA_SOURCE_SIZE_INVALID");
        entry.sourceBytes = sourceSize; entry.sourceSha = await hashFile(source);
        await record("validating-source");
        const progress = await run(ffmpeg, ["-v", "error", "-xerror", "-i", source, "-progress", "pipe:1", "-nostats", "-f", "null", "NUL"]);
        const seconds = verifiedVideoDecode(progress, Number(row.duration_ms) / 1000); entry.decodedSeconds = seconds;
        await record("preparing-mp4");
        const outputHeight = maxOutputHeight && maxOutputHeight < selected.height ? maxOutputHeight : selected.height;
        const outputWidth = Math.floor((selected.width * outputHeight / selected.height) / 2) * 2;
        const scale = outputHeight !== selected.height ? ["-vf", `scale=${outputWidth}:${outputHeight}`] : [];
        entry.outputWidth = outputWidth; entry.outputHeight = outputHeight;
        await run(ffmpeg, ["-v", "error", "-xerror", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0", ...scale, "-c:v", selected.videoCodec.startsWith("avc1") && !scale.length ? "copy" : "libx264", ...(!selected.videoCodec.startsWith("avc1") || scale.length ? ["-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"] : []), "-c:a", selected.audioCodec.startsWith("mp4a") ? "copy" : "aac", "-movflags", "+faststart", target]);
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
          if (samples.some(s => s.error || s.readyState < 3 || s.width !== outputWidth || s.height !== outputHeight || Math.abs(s.duration - seconds) > 2)) throw new Error("MEDIA_PLAYBACK_INVALID");
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
        entry.error = error instanceof Error && /^(MEDIA_|bunny-storage-)[a-zA-Z0-9_-]+$/u.test(error.message) ? error.message : error instanceof Error && error.name === "TimeoutError" ? "MEDIA_OPERATION_TIMEOUT" : "MEDIA_RECOVERY_FAILED";
        if (entry.error === "MEDIA_COMMAND_AGE_RESTRICTED") {
          const archived = await archiveUnhostableYoutubeVideo(db, {
            id: String(row.id),
            stable_key: String(row.stable_key),
            version: Number(row.version),
          }, new Date());
          if (archived) {
            excluded++; entry.excluded = true; entry.exclusionReason = "youtube-age-restricted";
            await record("excluded");
            continue;
          }
        }
        failed++; entry.failedStage = entry.stage;
        await record("failed");
      }
    }
    console.log(JSON.stringify({ migrated, excluded, failed, cancelled: abort.signal.aborted, sourceDeletions: 0 }));
    if (failed || abort.signal.aborted) process.exitCode = 1;
  } finally { await browser?.close(); await db.end(); await lock.close(); await rm(lockPath); }
}
main().catch(() => { console.error("MEDIA_RECOVERY_CONFIG_OR_LOCK_FAILED"); process.exitCode = 1; });
