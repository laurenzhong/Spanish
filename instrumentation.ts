/**
 * Server-start hook.
 *
 * Next.js runs `register()` once per server process (nodejs runtime). It is
 * used here only to warm two things in the background, so the first visitor does
 * not pay for them:
 *
 * - the public media catalogue, for `/learn` (the cold pooler handshake plus the
 *   wide catalogue query, measured together at 2.5-3 s cold, ~0.5 s warm);
 * - the vocabulary shelf's corpus snapshot, for `/read/vocabulary`. That one is
 *   not merely slow-but-bounded: the snapshot read plus the fold over ~63k forms
 *   measured **5.7 s** through the repository on its own, and a cold server
 *   measured **33.9 s** for the first shelf render once compilation was included,
 *   past the page's own 30 s guard — which is what showed the reader
 *   「词汇表暂时不可用 / 已发布内容仍然安全保留，请稍后刷新。」.
 *
 * Both are intentionally non-blocking and non-fatal: the imports and the reads are
 * fire-and-forget, so a missing database, an unreachable pooler or a build-time
 * run can never delay or fail the server. No user data is read.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.DATABASE_URL) return;
  console.log("[warmup] server start: warming the media catalogue and the vocabulary shelf");
  const { warmMediaCatalogue } = await import("./src/modules/media/application/warm-media-catalogue");
  void warmMediaCatalogue().then(
    () => console.log("[warmup] media catalogue warm"),
    (error: unknown) => console.log(`[warmup] media catalogue warm failed: ${String(error).slice(0, 120)}`),
  );
  // Imported by path rather than through the module's index: the warm-up reaches
  // for `getDatabase`, and the index is also pulled into client components.
  const { warmVocabularyShelf } = await import(
    "./src/modules/lexicon-corpus/application/warm-vocabulary-shelf"
  );
  void warmVocabularyShelf().then(
    () => console.log("[warmup] vocabulary shelf warm"),
    (error: unknown) => console.log(`[warmup] vocabulary shelf warm failed: ${String(error).slice(0, 120)}`),
  );
}
