import "dotenv/config";

import { spawn } from "node:child_process";
import postgres from "postgres";

const confirmation = "I_HAVE_AUTHORIZATION";
const limit = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 50);
const hostingSince = process.env.MEDIA_VIDEO_HOSTING_SINCE?.trim() || null;
if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("MEDIA_VIDEO_HOSTING_LIMIT_INVALID");
if (hostingSince && Number.isNaN(Date.parse(hostingSince))) throw new Error("MEDIA_VIDEO_HOSTING_SINCE_INVALID");

function run(candidateId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx/esm", "scripts/host-video-candidate-to-bunny.ts", candidateId], {
      stdio: "inherit",
      windowsHide: true,
      env: process.env,
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`MEDIA_VIDEO_HOSTING_FAILED:${candidateId}`)));
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
    const remaining = Math.max(0, limit - publishedToday);
    if (remaining === 0) {
      console.log(JSON.stringify({ requested: 0, hosted: 0, failed: 0, publishedToday, remaining }));
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
               and r.reviewer_reference='codex-ai-owner-authorized-review'
               and r.status='approved'
               and r.dimension in ('content-es-ES','teaching-zh-CN','structure')) = 3
      order by last_activity_at asc
      limit ${remaining}
    `;
    let hosted = 0;
    let failed = 0;
    for (const row of rows as unknown as { id: string }[]) {
      try { await run(row.id); hosted += 1; }
      catch { failed += 1; }
    }
    console.log(JSON.stringify({ requested: rows.length, hosted, failed, publishedToday, remaining }));
    if (failed > 0) process.exitCode = 2;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "MEDIA_VIDEO_HOSTING_FAILED"); process.exitCode = 1; });
