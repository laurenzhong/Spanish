import "dotenv/config";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { chromium } from "@playwright/test";

import { createBunnyStorageMediaAssetStorage } from "../src/modules/media/storage/bunny-storage";
import { classifyYoutubeRecoveryFailure } from "../src/modules/media/storage/youtube-recovery-failure";

const confirmation = "I_HAVE_AUTHORIZATION";
const candidateId = process.argv[2]?.trim();
const ffmpeg = process.env.FFMPEG_BIN?.trim() || "ffmpeg";
const ytdlp = process.env.YTDLP_BIN?.trim() || "yt-dlp";
const maxBytes = Number(process.env.MEDIA_VIDEO_MAX_BYTES ?? 1024 * 1024 * 1024);

if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
if (!candidateId || !/^[a-f0-9-]{36}$/u.test(candidateId)) throw new Error("CONTENT_CANDIDATE_ID_REQUIRED");
if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("MEDIA_VIDEO_MAX_BYTES_INVALID");

function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("MEDIA_VIDEO_COMMAND_TIMEOUT")); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2_000); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("MEDIA_VIDEO_COMMAND_UNAVAILABLE")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const failure = classifyYoutubeRecoveryFailure({
          diagnostic: stderr,
          code,
          exceededOutput: false,
          timedOut: false,
          aborted: false,
        });
        reject(new Error(`MEDIA_COMMAND_${failure}`));
      }
      else resolve(stdout);
    });
  });
}

async function sha256(filePath: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

async function main() {
  const storage = createBunnyStorageMediaAssetStorage();
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!storage || !databaseUrl) throw new Error("MEDIA_CONFIG_REQUIRED");
  const db = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  const directory = await mkdtemp(join(tmpdir(), "sueno-video-candidate-"));
  const source = join(directory, "source.mp4");
  const target = join(directory, "playback.mp4");
  let uploadedPath: string | null = null;
  let candidateLoaded = false;
  try {
    const rows = await db`
      select id, revision, metadata, status, publication_status
      from content_candidates
      where id=${candidateId} and content_type='video'
      limit 1
    `;
    const row = rows[0] as { id: string; revision: number; metadata: Record<string, unknown>; status: string; publication_status: string } | undefined;
    if (!row || row.status !== "review_ready" || row.publication_status !== "draft") throw new Error("CONTENT_CANDIDATE_NOT_READY_FOR_HOSTING");
    candidateLoaded = true;
    const draft = row.metadata.videoDraft as Record<string, unknown> | undefined;
    const videoId = typeof draft?.platformVideoId === "string" ? draft.platformVideoId : null;
    const stableKey = typeof draft?.stableKey === "string" ? draft.stableKey : null;
    const durationSeconds = typeof draft?.durationMs === "number" ? draft.durationMs / 1_000 : 0;
    if (!videoId || !/^[A-Za-z0-9_-]{6,64}$/u.test(videoId) || !stableKey || !/^youtube\.[a-z0-9._-]+$/u.test(stableKey) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("CONTENT_VIDEO_DRAFT_INVALID");

    const base = ["--ignore-config", "--no-playlist", "--js-runtimes", "node", "--force-ipv4", "--socket-timeout", "30", "--retries", "3", "--ffmpeg-location", ffmpeg];
    await run(ytdlp, [...base, "--no-progress", "--format", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4", "--output", source, `https://www.youtube.com/watch?v=${videoId}`], 20 * 60_000);
    const sourceInfo = await stat(source);
    if (!sourceInfo.size || sourceInfo.size > maxBytes) throw new Error("MEDIA_VIDEO_SIZE_INVALID");
    await run(ffmpeg, ["-v", "error", "-xerror", "-y", "-i", source, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", target], 20 * 60_000);
    const targetInfo = await stat(target);
    if (!targetInfo.size || targetInfo.size > maxBytes) throw new Error("MEDIA_VIDEO_TARGET_SIZE_INVALID");
    await run(ffmpeg, ["-v", "error", "-xerror", "-i", target, "-f", "null", "NUL"], 20 * 60_000);
    const sha = await sha256(target);
    const path = `media/${stableKey}/pending-${candidateId}/video-${sha}.mp4`;
    const targetUrl = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/${path}`;
    const result = storage.putVideoFromFile ? await storage.putVideoFromFile(path, target) : await storage.putVideo(path, await readFile(target), "video/mp4");
    if (result.url !== targetUrl) throw new Error("MEDIA_VIDEO_TARGET_INVALID");
    uploadedPath = path;
    const head = await fetch(targetUrl, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!head.ok || Number(head.headers.get("content-length")) !== targetInfo.size || !head.headers.get("content-type")?.startsWith("video/mp4")) throw new Error("MEDIA_VIDEO_CDN_INVALID");
    await head.body?.cancel();
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage();
      try {
        await page.setContent("<video muted></video>");
        await page.locator("video").evaluate((video: HTMLVideoElement, url) => { video.src = url; video.play().catch(() => undefined); }, targetUrl);
        await page.waitForFunction(() => document.querySelector("video")!.currentTime > 2, undefined, { timeout: 60_000 });
        await page.locator("video").evaluate((video: HTMLVideoElement, position) => { video.currentTime = position; }, Math.max(0, Math.floor(durationSeconds / 2)));
        await page.waitForFunction((position) => document.querySelector("video")!.currentTime > position + 1, Math.max(0, Math.floor(durationSeconds / 2)), { timeout: 60_000 });
      } finally { await page.close(); }
    } finally { await browser.close(); }
    const hostedAsset = { providerKey: "bunny-storage", playbackUrl: targetUrl, mimeType: "video/mp4", sha256: sha, byteSize: targetInfo.size };
    const updated = await db`
      update content_candidates
      set metadata = jsonb_set(metadata, '{bunnyVideoAsset}', ${JSON.stringify(hostedAsset)}::jsonb, true), updated_at=now(), last_activity_at=now()
      where id=${row.id} and revision=${row.revision} and status='review_ready' and publication_status='draft'
      returning id
    `;
    if (updated.length !== 1) throw new Error("CONTENT_CANDIDATE_CHANGED");
    console.log(JSON.stringify({ candidateId, stableKey, targetUrl, sha256: sha, byteSize: targetInfo.size }));
  } catch (error) {
    if (uploadedPath) await storage.remove(uploadedPath, "video").catch(() => undefined);
    if (candidateLoaded && error instanceof Error && error.message === "MEDIA_COMMAND_AGE_RESTRICTED") {
      // Keep the candidate row as an audit record, but make it impossible to
      // publish or surface as an available source after yt-dlp confirms the
      // platform age gate. The next acquisition run can provide other videos.
      await db`
        update content_candidates
        set status='rejected', rights_status='restricted', rejected_at=now(),
            metadata=jsonb_set(metadata, '{hostingExclusion}', ${JSON.stringify({ reason: "youtube-age-restricted" })}::jsonb, true),
            revision=revision + 1, last_activity_at=now(), updated_at=now()
        where id=${candidateId} and status='review_ready' and publication_status='draft'
      `;
    }
    throw error;
  } finally {
    await db.end();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "MEDIA_VIDEO_CANDIDATE_HOSTING_FAILED"); process.exitCode = 1; });
