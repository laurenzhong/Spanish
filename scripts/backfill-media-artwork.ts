import "dotenv/config";
import postgres from "postgres";
import { createBunnyStorageMediaArtworkStorage } from "@/src/modules/media/storage/artwork-storage";

const storage = createBunnyStorageMediaArtworkStorage();
if (!storage) throw new Error("Bunny media artwork storage is not configured.");
const artworkStorage = storage;
const connection = process.env.DATABASE_URL?.replace(/\s+/gu, "");
if (!connection) throw new Error("DATABASE_URL is required.");
const sql = postgres(connection, { prepare: false, max: 2 });

try {
  const rows = await sql<Readonly<{ id: string; stable_key: string; version: number; artwork_url: string; artwork_alt: string; artwork_source: "youtube" | "podcast-feed" | "fallback"; artwork_width: number | null; artwork_height: number | null }[]>>`
    select v.id, i.stable_key, v.version, v.artwork_url, v.artwork_alt, v.artwork_source, v.artwork_width, v.artwork_height
    from media_versions v join media_items i on i.id=v.media_item_id
    where v.status='published' and v.artwork_url is not null
      and v.artwork_url not like '%/storage/v1/object/public/media-artwork/%'
      and v.artwork_url not like '%/media/artwork/%'
    order by v.curated_at asc
  `;
  let migrated = 0;
  let failed = 0;
  async function migrate(row: typeof rows[number]): Promise<void> {
    try {
      const youtubeMatch = row.artwork_source === "youtube" ? /\/vi\/([A-Za-z0-9_-]{6,64})\//u.exec(row.artwork_url) : null;
      const sourceUrls = youtubeMatch
        ? ["maxresdefault", "hqdefault", "mqdefault", "0", "default"].map((size) => `https://images.weserv.nl/?url=${encodeURIComponent(`i.ytimg.com/vi/${youtubeMatch[1]}/${size}.jpg`)}`)
        : [row.artwork_url];
      let artwork: Awaited<ReturnType<typeof artworkStorage.snapshot>> | null = null;
      for (const sourceUrl of sourceUrls) {
        try {
          artwork = await Promise.race([artworkStorage.snapshot({ stableKey: row.stable_key, revision: row.version, artwork: {
            url: sourceUrl, alt: row.artwork_alt, source: row.artwork_source, width: row.artwork_width, height: row.artwork_height, expiresAt: null,
          } }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MEDIA_ARTWORK_TIMEOUT")), 20_000))]);
          break;
        } catch { /* Try the next stable YouTube thumbnail variant. */ }
      }
      if (!artwork) throw new Error("MEDIA_ARTWORK_FETCH_FAILED");
      await sql`update media_versions set artwork_url=${artwork.url}, artwork_expires_at=null, updated_at=now() where id=${row.id}`;
      migrated += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ stableKey: row.stable_key, error: error instanceof Error ? error.message : "UNKNOWN" }));
    }
  }
  for (let offset = 0; offset < rows.length; offset += 6) await Promise.all(rows.slice(offset, offset + 6).map(migrate));
  console.log(JSON.stringify({ scanned: rows.length, migrated, failed }));
} finally {
  await sql.end({ timeout: 5 });
}
