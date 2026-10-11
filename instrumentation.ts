/**
 * Server-start hook.
 *
 * Next.js runs `register()` once per server process (nodejs runtime). It is
 * used here only to warm the public media catalogue in the background, so the
 * first `/learn` visitor does not pay the cold pooler handshake plus the wide
 * catalogue query (measured together at 2.5-3 s cold, ~0.5 s warm).
 *
 * It is intentionally non-blocking and non-fatal: the import and the read are
 * fire-and-forget, so a missing database, an unreachable pooler or a build-time
 * run can never delay or fail the server. No user data is read.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;
  const { warmMediaCatalogue } = await import("./src/modules/media/application/warm-media-catalogue");
  void warmMediaCatalogue().catch(() => undefined);
}
