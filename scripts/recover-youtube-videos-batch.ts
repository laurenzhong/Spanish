import "dotenv/config";
import postgres from "postgres";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// One worker per video releases decoder/browser/upload memory before the next.
async function main() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== "I_HAVE_AUTHORIZATION") throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  const databaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("MEDIA_DATABASE_REQUIRED");
  const root = resolve(".tmp-runtime/youtube-recovered"); await mkdir(root, { recursive: true });
  const lockPath = resolve(root, "isolated-batch.lock"); const lock = await open(lockPath, "wx");
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const results: Array<{ stableKey: string; exitCode: number | null; finishedAt: string }> = [];
  let cancelled = false; let active: ChildProcess | undefined;
  const stop = () => { cancelled = true; active?.kill(); };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, stop);
  try {
    const db = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 15 });
    const rows = await db`select i.stable_key from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where i.kind='video' and a.kind='official_embed' and a.provider_key='youtube' and a.availability='available' and v.status='published' and v.copyright_status='cleared' order by i.stable_key`.finally(() => db.end());
    for (const row of rows) {
      if (cancelled) break;
      if (process.env.MEDIA_VIDEO_STABLE_KEY && row.stable_key !== process.env.MEDIA_VIDEO_STABLE_KEY) continue;
      const stableKey = String(row.stable_key);
      if (!/^youtube\.[a-z0-9._-]+$/u.test(stableKey)) throw new Error("MEDIA_ID_INVALID");
      const exitCode = await new Promise<number | null>(done => {
        active = spawn(process.execPath, ["--import", "tsx/esm", "scripts/recover-youtube-videos-to-bunny.ts"], {
          windowsHide: true, stdio: "inherit", env: { ...process.env, MEDIA_VIDEO_STABLE_KEY: stableKey },
        });
        active.once("error", () => done(-1)); active.once("close", code => done(code));
      });
      active = undefined; results.push({ stableKey, exitCode, finishedAt: new Date().toISOString() });
      await writeFile(resolve(root, "isolated-results.json"), JSON.stringify(results, null, 2));
    }
    console.log(JSON.stringify({ isolatedResults: results, cancelled }));
    if (cancelled || results.some(r => r.exitCode !== 0)) process.exitCode = 1;
  } finally {
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.removeListener(signal, stop);
    await lock.close(); await rm(lockPath);
  }
}
main().catch(() => { console.error("MEDIA_RECOVERY_BATCH_CONFIG_OR_LOCK_FAILED"); process.exitCode = 1; });
