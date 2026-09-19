import "dotenv/config";

import { spawn } from "node:child_process";
import { appendFile, copyFile, mkdtemp, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, like, or } from "drizzle-orm";

import * as schema from "../src/shared/db/schema";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createBunnyStorageMediaAssetStorage, createBunnyStreamMediaAssetStorage, createSupabaseMediaAssetStorage, MEDIA_VIDEO_BUCKET } from "../src/modules/media/storage";

const MAX_VIDEO_BYTES = Number(process.env.MEDIA_VIDEO_MAX_BYTES ?? 50 * 1024 * 1024);
const YTDLP_BIN = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const TRANSCODE_VIDEO = process.env.MEDIA_VIDEO_TRANSCODE !== "0";
const HOSTING_LIMIT = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 20);
const VIDEO_MAX_HEIGHT = Number(process.env.MEDIA_VIDEO_MAX_HEIGHT ?? 360);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.MEDIA_VIDEO_DOWNLOAD_TIMEOUT_MS ?? 10 * 60 * 1_000);
const REHOST_HOSTED = process.env.MEDIA_VIDEO_REHOST_HOSTED === "1";
const HOSTED_ONLY = process.env.MEDIA_VIDEO_HOSTED_ONLY === "1";
const STORAGE_PROVIDER = process.env.MEDIA_VIDEO_STORAGE_PROVIDER?.trim() || "supabase";
const TARGET_STABLE_KEY = process.env.MEDIA_VIDEO_STABLE_KEY?.trim() || null;
const COOKIES_FROM_BROWSER = process.env.MEDIA_VIDEO_COOKIES_FROM_BROWSER?.trim() || null;
const COOKIES_FILE = process.env.MEDIA_VIDEO_COOKIES_FILE?.trim() || null;
const LOCAL_VIDEO_FILE = process.env.MEDIA_VIDEO_LOCAL_FILE?.trim() || null;
if (COOKIES_FROM_BROWSER && COOKIES_FILE) throw new Error("MEDIA_VIDEO_COOKIES_FROM_BROWSER and MEDIA_VIDEO_COOKIES_FILE are mutually exclusive.");
const CONFIRMATION = "I_HAVE_AUTHORIZATION";

function safePath(stableKey: string, version: number) {
  if (!/^youtube\.[a-z0-9._-]{1,200}$/u.test(stableKey)) throw new Error("MEDIA_STABLE_KEY_INVALID");
  return `media/${stableKey}/${version}/video.mp4`;
}

function videoIdFromRow(platformSourceId: string | null, sourceUrl: string | null) {
  if (platformSourceId && /^[A-Za-z0-9_-]{6,64}$/u.test(platformSourceId)) return platformSourceId;
  if (!sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.hostname !== "www.youtube.com" || url.pathname !== "/watch") return null;
    const value = url.searchParams.get("v");
    return value && /^[A-Za-z0-9_-]{6,64}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function downloadVideo(videoId: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(YTDLP_BIN, [
      "--no-playlist",
      "--no-part",
      "--no-cache-dir",
      "--js-runtimes", "node",
      "--socket-timeout", "30",
      "--retries", "2",
      "--format", `bv*[ext=mp4][height<=${VIDEO_MAX_HEIGHT}]+ba[ext=m4a]/b[ext=mp4][height<=${VIDEO_MAX_HEIGHT}]/b[height<=${VIDEO_MAX_HEIGHT}]`,
      "--merge-output-format", "mp4",
      "--ffmpeg-location", FFMPEG_BIN,
      ...(COOKIES_FROM_BROWSER ? ["--cookies-from-browser", COOKIES_FROM_BROWSER] : COOKIES_FILE ? ["--cookies", COOKIES_FILE] : []),
      "--output", outputPath,
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("MEDIA_VIDEO_DOWNLOAD_TIMEOUT"));
    }, DOWNLOAD_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`MEDIA_VIDEO_DOWNLOADER_UNAVAILABLE: ${error.message}`));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      reject(new Error(`MEDIA_VIDEO_DOWNLOAD_FAILED: ${stderr.trim() || `exit ${code ?? "unknown"}`}`));
    });
  });
}

function transcodeVideo(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(FFMPEG_BIN, [
      "-y", "-i", inputPath,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", (error) => reject(new Error(`MEDIA_VIDEO_TRANSCODER_UNAVAILABLE: ${error.message}`)));
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`MEDIA_VIDEO_TRANSCODE_FAILED: ${stderr.trim() || `exit ${code ?? "unknown"}`}`)));
  });
}

async function downloadHostedVideo(url: string, outputPath: string) {
  const headerPath = `${outputPath}.headers`;
  await runCommand("curl.exe", ["-4", "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--max-time", String(Math.ceil(DOWNLOAD_TIMEOUT_MS / 1_000)), "--head", "--output", headerPath, url]);
  const headers = await readFile(headerPath, "utf8");
  await rm(headerPath, { force: true });
  const contentLength = Number((headers.match(/content-length:\s*(\d+)/iu) ?? [])[1]);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw new Error("MEDIA_VIDEO_SOURCE_LENGTH_UNKNOWN");
  await rm(outputPath, { force: true });
  const chunkSize = 4 * 1024 * 1024;
  for (let start = 0; start < contentLength; start += chunkSize) {
    const end = Math.min(contentLength - 1, start + chunkSize - 1);
    const chunkPath = `${outputPath}.${start}.part`;
    await runCommand("curl.exe", ["-4", "--fail", "--location", "--silent", "--show-error", "--retry", "3", "--max-time", String(Math.ceil(DOWNLOAD_TIMEOUT_MS / 1_000)), "--range", `${start}-${end}`, "--output", chunkPath, url]);
    const chunkBytes = await stat(chunkPath);
    if (chunkBytes.size !== end - start + 1) throw new Error("MEDIA_VIDEO_DOWNLOAD_CHUNK_INVALID");
    await appendFile(outputPath, await readFile(chunkPath));
    await rm(chunkPath, { force: true });
  }
  const outputBytes = await stat(outputPath);
  if (outputBytes.size !== contentLength) throw new Error("MEDIA_VIDEO_DOWNLOAD_INCOMPLETE");
}

function runCommand(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", (error) => reject(new Error(`MEDIA_VIDEO_COMMAND_UNAVAILABLE: ${error.message}`)));
    child.once("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`MEDIA_VIDEO_COMMAND_FAILED: ${stderr.trim() || `exit ${code ?? "unknown"}`}`)));
  });
}

if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set MEDIA_VIDEO_HOSTING_CONFIRM=${CONFIRMATION} only after confirming download and redistribution rights.`);
}
if (!Number.isSafeInteger(MAX_VIDEO_BYTES) || MAX_VIDEO_BYTES <= 0) throw new Error("MEDIA_VIDEO_MAX_BYTES_INVALID");
if (!Number.isSafeInteger(HOSTING_LIMIT) || HOSTING_LIMIT < 1 || HOSTING_LIMIT > 100) throw new Error("MEDIA_VIDEO_HOSTING_LIMIT_INVALID");
if (!Number.isSafeInteger(VIDEO_MAX_HEIGHT) || VIDEO_MAX_HEIGHT < 144 || VIDEO_MAX_HEIGHT > 2_160) throw new Error("MEDIA_VIDEO_MAX_HEIGHT_INVALID");
if (!Number.isSafeInteger(DOWNLOAD_TIMEOUT_MS) || DOWNLOAD_TIMEOUT_MS < 30_000) throw new Error("MEDIA_VIDEO_DOWNLOAD_TIMEOUT_INVALID");
if (TARGET_STABLE_KEY && !/^youtube\.[a-z0-9._-]{1,200}$/u.test(TARGET_STABLE_KEY)) throw new Error("MEDIA_VIDEO_STABLE_KEY_INVALID");

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const storage = STORAGE_PROVIDER === "bunny-stream"
  ? createBunnyStreamMediaAssetStorage()
  : STORAGE_PROVIDER === "bunny-storage"
    ? createBunnyStorageMediaAssetStorage()
  : STORAGE_PROVIDER === "supabase"
    ? createSupabaseMediaAssetStorage()
    : null;
if (!databaseUrl || !storage) throw new Error("DIRECT_DATABASE_URL/DATABASE_URL and the selected media storage provider credentials are required.");
const storageProviderKey = STORAGE_PROVIDER === "bunny-stream" ? "bunny-stream" : STORAGE_PROVIDER === "bunny-storage" ? "bunny-storage" : `supabase-storage:${MEDIA_VIDEO_BUCKET}`;
const connection = createDatabaseConnection(databaseUrl);
let hosted = 0;
let skipped = 0;
try {
  const rows = await connection.db.select({ item: schema.mediaItems, version: schema.mediaVersions, asset: schema.mediaAssets })
    .from(schema.mediaItems)
    .innerJoin(schema.mediaVersions, and(eq(schema.mediaVersions.mediaItemId, schema.mediaItems.id), eq(schema.mediaVersions.version, schema.mediaItems.currentVersion!)))
    .innerJoin(schema.mediaAssets, eq(schema.mediaAssets.mediaVersionId, schema.mediaVersions.id))
    .where(and(
      eq(schema.mediaItems.kind, "video"),
      ...(TARGET_STABLE_KEY ? [eq(schema.mediaItems.stableKey, TARGET_STABLE_KEY)] : []),
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      HOSTED_ONLY
        ? and(eq(schema.mediaAssets.kind, "video"), like(schema.mediaAssets.providerKey, "supabase-storage:%"))
        : REHOST_HOSTED
        ? or(
          and(eq(schema.mediaAssets.kind, "official_embed"), eq(schema.mediaAssets.providerKey, "youtube")),
          and(eq(schema.mediaAssets.kind, "video"), like(schema.mediaAssets.providerKey, "supabase-storage:%")),
        )
        : and(eq(schema.mediaAssets.kind, "official_embed"), eq(schema.mediaAssets.providerKey, "youtube")),
      eq(schema.mediaAssets.availability, "available"),
    ));

  for (const row of rows.slice(0, HOSTING_LIMIT)) {
    const videoId = videoIdFromRow(row.version.platformSourceId, row.version.sourceUrl);
    if (!videoId) {
      skipped += 1;
      process.stderr.write(`${row.item.stableKey}: MEDIA_VIDEO_ID_INVALID\n`);
      continue;
    }
    const directory = await mkdtemp(join(tmpdir(), "sueño-video-"));
    const outputPath = join(directory, `${videoId}.mp4`);
    const path = safePath(row.item.stableKey, row.version.version);
    let uploaded = false;
    try {
      const canFetchOrigin = STORAGE_PROVIDER === "bunny-stream" && REHOST_HOSTED && row.asset.kind === "video" && storage.putVideoFromUrl;
      if (canFetchOrigin) {
        const result = await storage.putVideoFromUrl(path, row.asset.playbackUrl);
        uploaded = true;
        await connection.db.update(schema.mediaAssets).set({
          kind: "video", providerKey: storageProviderKey, playbackUrl: result.url,
          playbackExpiresAt: null, mimeType: "video/mp4", updatedAt: new Date(),
        }).where(eq(schema.mediaAssets.id, row.asset.id));
        hosted += 1;
        continue;
      }
      if (REHOST_HOSTED && row.asset.kind === "video" && row.asset.providerKey.startsWith("supabase-storage:")) {
        await downloadHostedVideo(row.asset.playbackUrl, outputPath);
      } else if (LOCAL_VIDEO_FILE) {
        await copyFile(LOCAL_VIDEO_FILE, outputPath);
      } else {
        await downloadVideo(videoId, outputPath);
      }
      if (TRANSCODE_VIDEO) {
        const transcodedPath = join(directory, `${videoId}.h264.mp4`);
        await transcodeVideo(outputPath, transcodedPath);
        await rm(outputPath, { force: true });
        await rename(transcodedPath, outputPath);
      }
      const bytes = new Uint8Array(await readFile(outputPath));
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("MEDIA_VIDEO_TOO_LARGE");
      const result = STORAGE_PROVIDER === "bunny-stream" && REHOST_HOSTED && row.asset.kind === "video" && storage.putVideoFromUrl
        ? await storage.putVideoFromUrl(path, row.asset.playbackUrl)
        : await storage.putVideo(path, bytes, "video/mp4");
      uploaded = true;
      await connection.db.update(schema.mediaAssets).set({
        kind: "video",
        providerKey: storageProviderKey,
        playbackUrl: result.url,
        playbackExpiresAt: null,
        mimeType: "video/mp4",
        updatedAt: new Date(),
      }).where(eq(schema.mediaAssets.id, row.asset.id));
      hosted += 1;
    } catch (error) {
      if (uploaded) await storage.remove(path, "video").catch(() => undefined);
      skipped += 1;
      process.stderr.write(`${row.item.stableKey}: ${error instanceof Error ? error.message : "MEDIA_VIDEO_HOSTING_FAILED"}\n`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  process.stdout.write(JSON.stringify({ hosted, skipped }) + "\n");
} finally {
  await connection.client.end();
}
