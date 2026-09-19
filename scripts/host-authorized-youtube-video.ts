import "dotenv/config";

import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";

import * as schema from "../src/shared/db/schema";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createBunnyStorageMediaAssetStorage } from "../src/modules/media/storage";

const MAX_VIDEO_BYTES = Number(process.env.MEDIA_VIDEO_MAX_BYTES ?? 50 * 1024 * 1024);
const YTDLP_BIN = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const FFMPEG_BIN = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const TRANSCODE_VIDEO = process.env.MEDIA_VIDEO_TRANSCODE !== "0";
const HOSTING_LIMIT = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 20);
const VIDEO_MAX_HEIGHT = Number(process.env.MEDIA_VIDEO_MAX_HEIGHT ?? 360);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.MEDIA_VIDEO_DOWNLOAD_TIMEOUT_MS ?? 10 * 60 * 1_000);
const STORAGE_PROVIDER = process.env.MEDIA_VIDEO_STORAGE_PROVIDER?.trim() || "bunny-storage";
const TARGET_STABLE_KEY = process.env.MEDIA_VIDEO_STABLE_KEY?.trim() || null;
const COOKIES_FROM_BROWSER = process.env.MEDIA_VIDEO_COOKIES_FROM_BROWSER?.trim() || null;
const COOKIES_FILE = process.env.MEDIA_VIDEO_COOKIES_FILE?.trim() || null;
const LOCAL_VIDEO_FILE = process.env.MEDIA_VIDEO_LOCAL_FILE?.trim() || null;
if (COOKIES_FROM_BROWSER && COOKIES_FILE) throw new Error("MEDIA_VIDEO_COOKIES_FROM_BROWSER and MEDIA_VIDEO_COOKIES_FILE are mutually exclusive.");
const CONFIRMATION = "I_HAVE_AUTHORIZATION";

// This legacy CLI remains available for authorized recovery, but the product
// no longer permits Supabase/Bunny Stream video assets. All new video writes
// must land in Bunny Storage as immutable MP4 objects.
if (STORAGE_PROVIDER !== "bunny-storage") throw new Error("MEDIA_VIDEO_STORAGE_PROVIDER_MUST_BE_BUNNY_STORAGE");

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

if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set MEDIA_VIDEO_HOSTING_CONFIRM=${CONFIRMATION} only after confirming download and redistribution rights.`);
}
if (!Number.isSafeInteger(MAX_VIDEO_BYTES) || MAX_VIDEO_BYTES <= 0) throw new Error("MEDIA_VIDEO_MAX_BYTES_INVALID");
if (!Number.isSafeInteger(HOSTING_LIMIT) || HOSTING_LIMIT < 1 || HOSTING_LIMIT > 100) throw new Error("MEDIA_VIDEO_HOSTING_LIMIT_INVALID");
if (!Number.isSafeInteger(VIDEO_MAX_HEIGHT) || VIDEO_MAX_HEIGHT < 144 || VIDEO_MAX_HEIGHT > 2_160) throw new Error("MEDIA_VIDEO_MAX_HEIGHT_INVALID");
if (!Number.isSafeInteger(DOWNLOAD_TIMEOUT_MS) || DOWNLOAD_TIMEOUT_MS < 30_000) throw new Error("MEDIA_VIDEO_DOWNLOAD_TIMEOUT_INVALID");
if (TARGET_STABLE_KEY && !/^youtube\.[a-z0-9._-]{1,200}$/u.test(TARGET_STABLE_KEY)) throw new Error("MEDIA_VIDEO_STABLE_KEY_INVALID");

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const storage = createBunnyStorageMediaAssetStorage();
if (!databaseUrl || !storage) throw new Error("DIRECT_DATABASE_URL/DATABASE_URL and the selected media storage provider credentials are required.");
const storageProviderKey = "bunny-storage";
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
      and(eq(schema.mediaAssets.kind, "official_embed"), eq(schema.mediaAssets.providerKey, "youtube")),
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
      if (LOCAL_VIDEO_FILE) {
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
      const result = await storage.putVideo(path, bytes, "video/mp4");
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
