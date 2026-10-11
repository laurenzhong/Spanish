/**
 * Client-safe surface of the lexicon review provider.
 *
 * Deliberately excludes `minimax-lexicon-review.ts`, which imports `server-only`.
 * Import the adapter from `server.ts` instead, so a client bundle cannot pull the
 * vendor call path (or the API key read) into the browser build.
 */
export * from "./lexicon-review";
export * from "./fake-lexicon-review";
