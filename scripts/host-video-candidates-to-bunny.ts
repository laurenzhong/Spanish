import "dotenv/config";

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import postgres from "postgres";

import { getMediaVideoHostingBatchLimit } from "../src/modules/content-acquisition/media/video-hosting-batch-limit";
import { resolveAuthorizedVideoAssetPath } from "../src/modules/content-acquisition/media/authorized-video-asset";

const confirmation = "I_HAVE_AUTHORIZATION";
const limit = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 50);
const hostingSince = process.env.MEDIA_VIDEO_HOSTING_SINCE?.trim() || null;
const canaryOnly = process.env.MEDIA_VIDEO_HOSTING_CANARY_ONLY === "true";
const canaryCandidateLimit = 10;
if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("MEDIA_VIDEO_HOSTING_LIMIT_INVALID");
if (hostingSince && Number.isNaN(Date.parse(hostingSince))) throw new Error("MEDIA_VIDEO_HOSTING_SINCE_INVALID");
if (process.env.MEDIA_VIDEO_LOCAL_FILE?.trim()) throw new Error("MEDIA_VIDEO_LOCAL_FILE_NOT_ALLOWED_IN_BATCH");

async function run(candidateId: string, assetDirectory: string | null): Promise<"authorized-mp4" | "youtube"> {
  const localFile = resolveAuthorizedVideoAssetPath(assetDirectory, candidateId);
  let assetSource: "authorized-mp4" | "youtube" = "youtube";
  if (localFile) {
    try {
      await access(localFile);
      assetSource = "authorized-mp4";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.MEDIA_VIDEO_LOCAL_FILE;
    if (assetSource === "authorized-mp4" && localFile) env.MEDIA_VIDEO_LOCAL_FILE = localFile;
    const child = spawn(process.execPath, ["--import", "tsx/esm", "scripts/host-video-candidate-to-bunny.ts", candidateId], {
      stdio: "inherit",
      windowsHide: true,
      env,
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(assetSource) : reject(new Error(`MEDIA_VIDEO_HOSTING_FAILED:${candidateId}`)));
  });
}

async function main() {
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("MEDIA_CONFIG_REQUIRED");
  const db = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    const now = new Date();
    const dateParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const datePart = (type: Intl.DateTimeFormatPartTypes) => dateParts.find((part) => part.type === type)?.value;
    const naturalDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
    const dayStart = new Date(`${naturalDate}T00:00:00+08:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1_000);
    const publishedRows = await db`
      select count(*)::int as count
      from content_candidates
      where content_type='video' and publication_status='published'
        and published_at_internal >= ${dayStart}
        and published_at_internal < ${dayEnd}
    `;
    const publishedToday = Number((publishedRows as unknown as { count?: number | string }[])[0]?.count ?? 0);
    const remaining = getMediaVideoHostingBatchLimit(limit, publishedToday, canaryOnly);
    if (remaining === 0) {
      console.log(JSON.stringify({ requested: 0, hosted: 0, failed: 0, publishedToday, remaining, ...(canaryOnly ? { canaryOnly: true, canaryCandidateId: null } : {}) }));
      return;
    }
    const rows = await db`
      select id
      from content_candidates
      where content_type='video' and status='review_ready' and publication_status='draft'
        ${hostingSince ? db`and updated_at >= ${hostingSince}` : db``}
        and not (metadata ? 'bunnyVideoAsset')
        and (select count(distinct r.dimension) from candidate_reviews r
             where r.candidate_id=content_candidates.id
               and r.candidate_revision=content_candidates.revision
               and r.status='approved'
               -- Accept both the historical codex-* identity and the current
               -- dsh-ai-owner-authorized-review[:actor[:runId]] identity.
               and (r.reviewer_reference='codex-ai-owner-authorized-review' or r.reviewer_reference like 'dsh-ai-owner-authorized-review%')
               and r.dimension in ('content-es-ES','teaching-zh-CN','structure')) = 3
      order by last_activity_at asc
      limit ${canaryOnly ? canaryCandidateLimit : remaining}
    `;
    if (canaryOnly && rows.length === 0) {
      console.log(JSON.stringify({ requested: 0, hosted: 0, failed: 0, publishedToday, remaining, canaryOnly: true, canaryCandidateId: null }));
      process.exitCode = 3;
      return;
    }
    let hosted = 0;
    let failed = 0;
    let authorizedMp4 = 0;
    let youtube = 0;
    let canaryCandidateId: string | null = null;
    const assetDirectory = process.env.MEDIA_VIDEO_AUTHORIZED_ASSET_DIR?.trim() || null;
    for (const row of rows as unknown as { id: string }[]) {
      try {
        const source = await run(row.id, assetDirectory);
        hosted += 1;
        canaryCandidateId = row.id;
        if (source === "authorized-mp4") authorizedMp4 += 1;
        else youtube += 1;
        if (canaryOnly) break;
      } catch {
        failed += 1;
      }
    }
    console.log(JSON.stringify({ requested: rows.length, hosted, failed, authorizedMp4, youtube, publishedToday, remaining, ...(canaryOnly ? { canaryOnly: true, canaryCandidateId, candidatesChecked: Math.min(rows.length, failed + hosted) } : {}) }));
    if (failed > 0) process.exitCode = 2;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "MEDIA_VIDEO_HOSTING_FAILED"); process.exitCode = 1; });
