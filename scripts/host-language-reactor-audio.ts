import "dotenv/config";

import { and, eq } from "drizzle-orm";
import * as schema from "../src/shared/db/schema";
import { createDatabaseConnection } from "../src/shared/db/client";
import { createSupabaseMediaAssetStorage, MEDIA_AUDIO_BUCKET } from "../src/modules/media/storage";

// Supabase project plans commonly cap a single object at 50 MB. Keep this
// guard below that limit until the project explicitly raises it.
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const AUDIO_HOSTS = new Set(["content.libsyn.com", "traffic.libsyn.com", "traffic.megaphone.fm", "dcs-spotify.megaphone.fm", "ztnr.rtve.es", "rtve-mediavod-lote3.rtve.es"]);
const LANGUAGE_REACTOR_API = "https://api-cdn.dioco.io/base_media_getMediaDocs_5";

function safePath(stableKey: string, version: number) {
  if (!/^podcast\.language-reactor\.[a-z0-9._-]{1,200}$/u.test(stableKey)) throw new Error("MEDIA_STABLE_KEY_INVALID");
  return `media/${stableKey}/${version}/audio`;
}

async function readAudio(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !AUDIO_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("MEDIA_SOURCE_NOT_ALLOWED");
  const response = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  const finalUrl = new URL(response.url || parsed.toString());
  if (!response.ok || !response.body || finalUrl.protocol !== "https:" || !AUDIO_HOSTS.has(finalUrl.hostname.toLowerCase())) throw new Error("MEDIA_SOURCE_UNAVAILABLE");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "";
  if (!contentType.startsWith("audio/")) throw new Error("MEDIA_MIME_INVALID");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_AUDIO_BYTES) throw new Error("MEDIA_AUDIO_TOO_LARGE");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_AUDIO_BYTES) throw new Error("MEDIA_AUDIO_TOO_LARGE");
  return { bytes, contentType };
}

async function refreshedSource(stableKey: string) {
  const docId = stableKey.slice("podcast.language-reactor.".length);
  const response = await fetch(LANGUAGE_REACTOR_API, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ userEmail: null, diocoToken: null, translationLang_G: "zh-CN", freq95: { min: 0, max: 100_000 }, lang_G: "es", filters: { mediaTab: "TAB_PODCASTS" }, pinnedDiocoPlaylistIds: [], selectedDiocoPlaylistId: "t_pd_mix_es", diocoPlaylistId: "t_pd_mix_es", forceIncludeDiocoDocId: docId, offset: 0, limit: 100 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("MEDIA_SOURCE_REFRESH_FAILED");
  const body = await response.json() as { data?: { docs_metadata?: Array<{ diocoDocId?: string; audioFileURL?: string }> } };
  const match = body.data?.docs_metadata?.find((doc) => doc.diocoDocId?.toLowerCase() === docId.toLowerCase());
  if (!match?.audioFileURL) throw new Error("MEDIA_SOURCE_REFRESH_FAILED");
  return match.audioFileURL;
}

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
    .where(and(eq(schema.mediaItems.kind, "podcast"), eq(schema.mediaVersions.status, "published"), eq(schema.mediaAssets.kind, "audio"), eq(schema.mediaAssets.providerKey, "language-reactor")));
  for (const row of rows) {
    const path = safePath(row.item.stableKey, row.version.version);
    let audio: Awaited<ReturnType<typeof readAudio>>;
    try {
      try {
        audio = await readAudio(row.asset.playbackUrl);
      } catch {
        audio = await readAudio(await refreshedSource(row.item.stableKey));
      }
    } catch (error) {
      skipped += 1;
      process.stderr.write(`${row.item.stableKey}: ${error instanceof Error ? error.message : "MEDIA_HOSTING_SKIPPED"}\n`);
      continue;
    }
    const { bytes, contentType } = audio;
    let uploaded = false;
    try {
      const result = await storage.putAudio(path, bytes, contentType);
      uploaded = true;
      await connection.db.update(schema.mediaAssets).set({ providerKey: `supabase-storage:${MEDIA_AUDIO_BUCKET}`, playbackUrl: result.url, playbackExpiresAt: null, mimeType: contentType, updatedAt: new Date() }).where(eq(schema.mediaAssets.id, row.asset.id));
      hosted += 1;
    } catch (error) {
      if (uploaded) await storage.remove(path).catch(() => undefined);
      skipped += 1;
      process.stderr.write(`${row.item.stableKey}: ${error instanceof Error ? error.message : "MEDIA_HOSTING_FAILED"}\n`);
    }
  }
  process.stdout.write(JSON.stringify({ hosted, skipped }) + "\n");
} finally {
  await connection.client.end();
}
