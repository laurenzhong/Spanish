import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { z } from "zod";

const schema = z.object({ assetId: z.uuid(), stableKey: z.string().regex(/^podcast\.language-reactor\.[a-z0-9._-]+$/u), version: z.number().int().positive(), sourceProvider: z.string(), sourceUrlHash: z.string().regex(/^[a-f0-9]{64}$/u), sha256: z.string().regex(/^[a-f0-9]{64}$/u), bytes: z.number().int().positive().max(512 * 1024 * 1024), targetUrl: z.url(), databaseSwitched: z.boolean(), sourceDeleted: z.boolean() });
const hash = (input: Uint8Array | string) => createHash("sha256").update(input).digest("hex");
async function main() {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !secret || !process.env.DATABASE_URL || !process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME) throw new Error("AUDIO_CONFIG_REQUIRED");
  const confirmed = process.env.MEDIA_AUDIO_CLEANUP_CONFIRM === "DELETE_VERIFIED_SUPABASE_AUDIO_OBJECTS";
  const root = resolve(".tmp-runtime/bunny-podcast-migration");
  const proofs = z.array(z.object({ assetId: z.uuid(), targetUrl: z.url(), passed: z.boolean(), verifiedAt: z.iso.datetime() })).parse(JSON.parse(await readFile(".tmp-runtime/bunny-podcast-website-verification.json", "utf8")));
  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    for (const directory of await readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[a-f0-9-]{36}$/u.test(directory.name)) continue;
      const manifestPath = resolve(root, directory.name, "manifest.json");
      const raw = JSON.parse(await readFile(manifestPath, "utf8"));
      if (!raw.databaseSwitched || raw.sourceProvider !== "supabase-storage:media-audio") continue;
      const entry = schema.parse(raw);
      const expected = `https://${process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME}/media/${entry.stableKey}/${entry.version}/audio-${entry.sha256}.mp3`;
      if (entry.targetUrl !== expected) throw new Error("AUDIO_TARGET_MISMATCH");
      if (!proofs.some((p) => p.assetId === entry.assetId && p.targetUrl === expected && p.passed && Date.parse(p.verifiedAt) <= Date.now() && Date.now() - Date.parse(p.verifiedAt) < 86400000)) throw new Error("AUDIO_WEBSITE_PROOF_REQUIRED");
      const all = await client`select a.id,a.playback_url from media_assets a where a.provider_key='supabase-storage:media-audio'`;
      const retiredUrl = typeof raw.retiredSupabasePath === "string" ? `${origin}/storage/v1/object/public/media-audio/${raw.retiredSupabasePath.split("/").map(encodeURIComponent).join("/")}` : null;
      const old = all.find((r) => hash(String(r.playback_url)) === entry.sourceUrlHash)
        ?? (retiredUrl && hash(retiredUrl) === entry.sourceUrlHash ? { playback_url: retiredUrl } : null);
      if (!old) { console.log(JSON.stringify({ stableKey: entry.stableKey, status: entry.sourceDeleted ? "already-deleted" : "no-old-reference-check-audit" })); continue; }
      const oldUrl = new URL(old.playback_url);
      const prefix = "/storage/v1/object/public/media-audio/";
      if (oldUrl.origin !== new URL(origin).origin || oldUrl.protocol !== "https:" || oldUrl.search || oldUrl.hash || oldUrl.username || oldUrl.password || !oldUrl.pathname.startsWith(`${prefix}media/${entry.stableKey}/`)) throw new Error("AUDIO_SOURCE_INVALID");
      const path = decodeURIComponent(oldUrl.pathname.slice(prefix.length));
      if (path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("AUDIO_PATH_INVALID");
      console.log(JSON.stringify({ stableKey: entry.stableKey, status: confirmed ? "verifying-cdn" : "dry-run" }));
      if (!confirmed) continue;
      const response = await fetch(expected, { redirect: "error", signal: AbortSignal.timeout(300000) });
      if (response.status !== 200 || Number(response.headers.get("content-length")) !== entry.bytes || !response.headers.get("content-type")?.startsWith("audio/mpeg")) { await response.body?.cancel(); throw new Error("AUDIO_CDN_INVALID"); }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error("AUDIO_CDN_HASH_MISMATCH");
      let history = 0;
      await client.begin(async (tx) => {
        await tx`set local lock_timeout='5s'`; await tx`lock table media_assets in share row exclusive mode`;
        const current = await tx`select a.id from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where a.id=${entry.assetId} and a.provider_key='bunny-storage' and a.playback_url=${expected} and a.availability='available' and v.status='published' and v.copyright_status='cleared' for update of a,v,i`;
        if (current.length !== 1) throw new Error("AUDIO_CURRENT_CHANGED");
        const refs = await tx`select a.id,a.kind,a.provider_key,v.copyright_status,i.stable_key from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id where a.playback_url=${old.playback_url} for update of a,v,i`;
        if (refs.some((r) => r.kind !== "audio" || r.provider_key !== "supabase-storage:media-audio" || r.copyright_status !== "cleared" || r.stable_key !== entry.stableKey)) throw new Error("AUDIO_REFERENCE_BLOCKS_DELETE");
        history = refs.length;
        await tx`update media_assets set playback_url=${expected},provider_key='bunny-storage',playback_expires_at=null,updated_at=now() where playback_url=${old.playback_url}`;
      });
      // Persist the retired object before deletion so a failure is recoverable even with zero old references.
      raw.retiredSupabasePath = path; raw.historicalAssetsRelocated = Number(raw.historicalAssetsRelocated ?? 0) + history;
      await writeFile(manifestPath, JSON.stringify(raw,null,2));
      await client.begin(async (tx) => {
        await tx`set local lock_timeout='5s'`; await tx`lock table media_assets in share row exclusive mode`;
        if ((await tx`select id from media_assets where playback_url=${old.playback_url}`).length) throw new Error("AUDIO_REFERENCE_BLOCKS_DELETE");
        const deleted = await fetch(`${origin}/storage/v1/object/media-audio`, { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(30000), headers: { apikey: secret, Authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
        await deleted.body?.cancel(); if (!deleted.ok) throw new Error("AUDIO_DELETE_FAILED");
      });
      const remains = await client`select id from storage.objects where bucket_id='media-audio' and name=${path}`;
      if (remains.length) throw new Error("AUDIO_DELETE_UNCONFIRMED");
      raw.sourceDeleted = true; raw.deletedAt = new Date().toISOString();
      await writeFile(manifestPath, JSON.stringify(raw,null,2));
      console.log(JSON.stringify({ stableKey: entry.stableKey, status: "source-deleted", historicalAssetsRelocated: history }));
    }
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error instanceof Error && /^AUDIO_[A-Z_]+$/u.test(error.message) ? error.message : "AUDIO_CLEANUP_FAILED"); process.exitCode = 1; });
