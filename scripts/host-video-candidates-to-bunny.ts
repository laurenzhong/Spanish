import "dotenv/config";

import { spawn } from "node:child_process";
import postgres from "postgres";

const confirmation = "I_HAVE_AUTHORIZATION";
const limit = Number(process.env.MEDIA_VIDEO_HOSTING_LIMIT ?? 50);
if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error("MEDIA_VIDEO_HOSTING_LIMIT_INVALID");

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
    const rows = await db`
      select id
      from content_candidates
      where content_type='video' and status='review_ready' and publication_status='draft'
        and not (metadata ? 'bunnyVideoAsset')
        and (select count(distinct r.dimension) from candidate_reviews r
             where r.candidate_id=content_candidates.id
               and r.candidate_revision=content_candidates.revision
               and r.reviewer_reference='codex-ai-owner-authorized-review'
               and r.status='approved'
               and r.dimension in ('content-es-ES','teaching-zh-CN','structure')) = 3
      order by last_activity_at asc
      limit ${limit}
    `;
    let hosted = 0;
    let failed = 0;
    for (const row of rows as unknown as { id: string }[]) {
      try { await run(row.id); hosted += 1; }
      catch { failed += 1; }
    }
    console.log(JSON.stringify({ requested: rows.length, hosted, failed }));
    if (failed > 0) process.exitCode = 2;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "MEDIA_VIDEO_HOSTING_FAILED"); process.exitCode = 1; });
