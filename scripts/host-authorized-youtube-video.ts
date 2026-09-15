import "dotenv/config";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";

import * as schema from "../src/shared/db/schema";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createSupabaseMediaAssetStorage, MEDIA_VIDEO_BUCKET } from "../src/modules/media/storage";

const MAX_VIDEO_BYTES = Number(process.env.MEDIA_VIDEO_MAX_BYTES ?? 512 * 1024 * 1024);
const YTDLP_BIN = process.env.YTDLP_BIN?.trim() || "yt-dlp";
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
      "--format", "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/b[height<=720]",
      "--merge-output-format", "mp4",
      "--output", outputPath,
      `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000); });
    child.once("error", (error) => reject(new Error(`MEDIA_VIDEO_DOWNLOADER_UNAVAILABLE: ${error.message}`)));
    child.once("close", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`MEDIA_VIDEO_DOWNLOAD_FAILED: ${stderr.trim() || `exit ${code ?? "unknown"}`}`));
    });
  });
}

if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set MEDIA_VIDEO_HOSTING_CONFIRM=${CONFIRMATION} only after confirming download and redistribution rights.`);
}
if (!Number.isSafeInteger(MAX_VIDEO_BYTES) || MAX_VIDEO_BYTES <= 0) throw new Error("MEDIA_VIDEO_MAX_BYTES_INVALID");

const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const storage = createSupabaseMediaAssetStorage();
if (!databaseUrl || !storage) throw new Error("DIRECT_DATABASE_URL/DATABASE_URL and Supabase secret are required.");
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
      eq(schema.mediaVersions.status, "published"),
      eq(schema.mediaVersions.copyrightStatus, "cleared"),
      eq(schema.mediaAssets.kind, "official_embed"),
      eq(schema.mediaAssets.providerKey, "youtube"),
      eq(schema.mediaAssets.availability, "available"),
    ));

  for (const row of rows) {
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
      await downloadVideo(videoId, outputPath);
      const bytes = new Uint8Array(await readFile(outputPath));
      if (bytes.byteLength <= 0 || bytes.byteLength > MAX_VIDEO_BYTES) throw new Error("MEDIA_VIDEO_TOO_LARGE");
      const result = await storage.putVideo(path, bytes, "video/mp4");
      uploaded = true;
      await connection.db.update(schema.mediaAssets).set({
        kind: "video",
        providerKey: `supabase-storage:${MEDIA_VIDEO_BUCKET}`,
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
