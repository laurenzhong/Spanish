/**
 * Server-only entry point.
 *
 * Kept out of `index.ts` on purpose: the adapter imports `server-only`, so
 * anything that pulls it in can no longer be imported from client code without an
 * explicit mock. Tests import from here and stub `server-only`.
 */
export * from "./minimax-lexicon-review";
