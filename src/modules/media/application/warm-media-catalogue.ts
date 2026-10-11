import { getDatabase } from "@/src/shared/db/client";

import { createDrizzleMediaRepository } from "../repositories";
import { mediaListQuerySchema, type MediaListQuery } from "../schemas";
import { listMedia } from "./list-media";

/**
 * The query a bare `/learn` visit asks for.
 *
 * Shared with the warm-up below so both fill and read the same catalogue cache
 * entry (the cache key is the serialised query). Zod applies the schema
 * defaults here, so `{ pageSize: 24 }` normalises to exactly what the page
 * parses out of an empty `searchParams`.
 */
export function defaultMediaListQuery(): MediaListQuery {
  return mediaListQuerySchema.parse({ pageSize: 24 });
}

/**
 * Reads the public media catalogue once, in the background, when the server
 * process starts.
 *
 * The first `/learn` visit of a cold process pays for two things the user
 * should not wait on: the pooler handshake (measured ~2.0 s for `select 1`
 * cold against ~224 ms warm) and the wide three-table catalogue join
 * (0.5-3 s). Warming both moves that cost to boot, and every later visit is a
 * cache hit plus the per-user progress read.
 *
 * Deliberately fire-and-forget: it must never delay or fail a server start,
 * and a warm-up that does not happen is simply today's behaviour. No user data
 * is read - the warm query passes no user id, so it touches only the public
 * catalogue.
 */
export async function warmMediaCatalogue(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const repository = createDrizzleMediaRepository(getDatabase());
  await listMedia(repository, defaultMediaListQuery());
}
