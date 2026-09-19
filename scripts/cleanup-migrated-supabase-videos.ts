import "dotenv/config";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { canRelocateHostedVideoReferences, validateHostedSource } from "../src/modules/media/storage/hosted-video-integrity";

const entrySchema = z.object({
  assetId: z.uuid(), stableKey: z.string().regex(/^youtube\.[a-z0-9._-]{1,200}$/u),
  sourceUrl: z.url(), targetUrl: z.url(), targetSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  targetBytes: z.number().int().positive(), databaseSwitched: z.literal(true),
});
const proofSchema = z.array(z.object({
  assetId: z.uuid(), stableKey: z.string(), passed: z.boolean(), verifiedAt: z.iso.datetime(),
  playback: z.object({ duration: z.number().positive(), currentTime: z.number().positive(), readyState: z.number().min(3), error: z.null() }).optional(),
}));

async function main() {
  const confirmed = process.env.MEDIA_VIDEO_CLEANUP_CONFIRM === "DELETE_VERIFIED_SUPABASE_VIDEO_OBJECTS";
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bunny = process.env.BUNNY_STORAGE_PULL_ZONE_HOSTNAME;
  if (!origin || !secret || !bunny || !process.env.DATABASE_URL) throw new Error("MEDIA_CONFIG_REQUIRED");
  const proofs = proofSchema.parse(JSON.parse(await readFile(".tmp-runtime/bunny-website-verification.json", "utf8")));
  const entries: z.infer<typeof entrySchema>[] = [];
  const first = JSON.parse(await readFile(".tmp-runtime/bunny-migration-verified-first.json", "utf8"));
  if (first.databaseSwitched) entries.push(entrySchema.parse({
    assetId: "08663ffd-8f13-4860-a340-033c41454b64", stableKey: first.stableKey,
    sourceUrl: `${origin}/storage/v1/object/public/media-video/media/${first.stableKey}/3/video.mp4`,
    targetUrl: first.bunnyUrl, targetSha256: first.sha256, targetBytes: first.uploadedBytes, databaseSwitched: true,
  }));
  const root = resolve(".tmp-runtime/bunny-hosted-migration");
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory() || !/^[a-f0-9-]{36}$/u.test(directory.name)) continue;
    const m = JSON.parse(await readFile(resolve(root, directory.name, "manifest.json"), "utf8"));
    if (m.databaseSwitched) entries.push(entrySchema.parse(m));
  }
  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  const results: object[] = [];
  try {
    for (const entry of entries) {
      const source = validateHostedSource(entry.sourceUrl, origin);
      const target = new URL(entry.targetUrl);
      if (target.origin !== `https://${bunny}` || target.username || target.password || target.search || target.hash || !target.pathname.startsWith(`/media/${entry.stableKey}/`)) throw new Error("MEDIA_TARGET_INVALID");
      const proof = proofs.find((p) => p.assetId === entry.assetId && p.stableKey === entry.stableKey && p.passed && p.playback && Date.parse(p.verifiedAt) <= Date.now() && Date.now() - Date.parse(p.verifiedAt) < 24 * 60 * 60_000);
      if (!proof) { results.push({ stableKey: entry.stableKey, status: "blocked-missing-website-proof" }); continue; }
      const priorRefs = await client`select a.id,v.version,v.status,v.copyright_status from media_assets a join media_versions v on v.id=a.media_version_id where a.playback_url=${entry.sourceUrl}`;
      if (!confirmed) { results.push({ stableKey: entry.stableKey, status: "dry-run", historicalReferences: priorRefs.length }); continue; }
      try {
        // Reverify all delivered bytes immediately before retiring the original.
        const response = await fetch(entry.targetUrl, { redirect: "error", signal: AbortSignal.timeout(300_000) });
        if (response.status !== 200 || !response.body || !response.headers.get("content-type")?.startsWith("video/mp4")) throw new Error("MEDIA_CDN_UNAVAILABLE");
        const hash = createHash("sha256"); let bytes = 0;
        const reader = response.body.getReader();
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > entry.targetBytes) throw new Error("MEDIA_CDN_SIZE_MISMATCH");
            hash.update(next.value);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (bytes !== entry.targetBytes || hash.digest("hex") !== entry.targetSha256) throw new Error("MEDIA_CDN_HASH_MISMATCH");
        let historicalUpdated = 0;
        await client.begin(async (tx) => {
          await tx`set local lock_timeout='5s'`;
          // Prevent a concurrent publication from adding a reference between check and deletion.
          await tx`lock table media_assets in share row exclusive mode`;
          const active = await tx`select a.id from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id and i.current_version=v.version where a.id=${entry.assetId} and a.playback_url=${entry.targetUrl} and a.provider_key='bunny-storage' and a.availability='available' and v.status='published' and v.copyright_status='cleared' for update of a,v,i`;
          if (active.length !== 1) throw new Error("MEDIA_CURRENT_ASSET_CHANGED");
          const references = await tx`select a.id,a.kind,a.provider_key,v.media_item_id,i.stable_key,v.copyright_status from media_assets a join media_versions v on v.id=a.media_version_id join media_items i on i.id=v.media_item_id where a.playback_url=${entry.sourceUrl} for update of a,v,i`;
          if (!canRelocateHostedVideoReferences(entry.stableKey, references.map((r) => ({ kind: String(r.kind), provider_key: String(r.provider_key), stable_key: String(r.stable_key), copyright_status: String(r.copyright_status) })))) throw new Error("MEDIA_SOURCE_REFERENCE_BLOCKS_DELETE");
          if (references.length) {
            await tx`update media_assets set provider_key='bunny-storage', playback_url=${entry.targetUrl}, playback_expires_at=null, updated_at=now() where playback_url=${entry.sourceUrl}`;
            historicalUpdated = references.length;
          }
        });
        // Commit historical relocation first: deletion cannot roll it back to a missing source.
        await client.begin(async (tx) => {
          await tx`set local lock_timeout='5s'`;
          await tx`lock table media_assets in share row exclusive mode`;
          const remaining = await tx`select id from media_assets where playback_url=${entry.sourceUrl}`;
          if (remaining.length) throw new Error("MEDIA_SOURCE_REFERENCE_BLOCKS_DELETE");
          const targetRefs = await tx`select id from media_assets where id=${entry.assetId} and playback_url=${entry.targetUrl} and provider_key='bunny-storage'`;
          if (targetRefs.length !== 1) throw new Error("MEDIA_CURRENT_ASSET_CHANGED");
          const prefix = "/storage/v1/object/public/media-video/";
          const objectPath = decodeURIComponent(source.pathname.slice(prefix.length));
          if (!objectPath.startsWith(`media/${entry.stableKey}/`) || objectPath.split("/").some((part) => part === ".." || part === "." || !part)) throw new Error("MEDIA_DELETE_PATH_INVALID");
          const deleted = await fetch(`${origin}/storage/v1/object/media-video`, {
            method: "DELETE", redirect: "error", signal: AbortSignal.timeout(30_000),
            headers: { apikey: secret, Authorization: `Bearer ${secret}`, "content-type": "application/json" },
            body: JSON.stringify({ prefixes: [objectPath] }),
          });
          await deleted.body?.cancel();
          if (!deleted.ok) throw new Error("MEDIA_SOURCE_DELETE_FAILED");
        });
        // Storage API deletion succeeded; public CDN cache may still serve old bytes temporarily.
        results.push({ stableKey: entry.stableKey, status: "source-deleted", historicalUpdated, targetHashVerified: true, deletedAt: new Date().toISOString() });
      } catch (error) {
        results.push({ stableKey: entry.stableKey, status: "retained-or-delete-unconfirmed", error: error instanceof Error && /^MEDIA_[A-Z_]+$/u.test(error.message) ? error.message : "MEDIA_CLEANUP_FAILED" });
        process.exitCode = 1;
      }
      await writeFile(".tmp-runtime/bunny-source-cleanup-results.json", JSON.stringify(results,null,2));
      console.log(JSON.stringify(results.at(-1)));
    }
    if (!confirmed) console.log(JSON.stringify(results));
  } finally { await client.end(); }
}
main().catch(() => { console.error("MEDIA_CLEANUP_CONFIG_OR_MANIFEST_INVALID"); process.exitCode = 1; });
