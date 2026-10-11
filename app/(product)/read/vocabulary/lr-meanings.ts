import { readFileSync } from "node:fs";
import path from "node:path";

import { parseMeaningAsset, type MeaningAsset } from "@/src/modules/lexicon-corpus/ui/vocabulary-meanings";

/**
 * The Language Reactor meaning asset, read once per server process.
 *
 * Read at runtime rather than imported at build time: the scrape lands the asset
 * after this UI ships, and a static import of a file that does not exist yet
 * would fail the build. An absent or unreadable asset is not an error — every
 * word then falls back to the reviewed glossary or to 「释义待补充」, which is
 * exactly what a shelf without the asset should show.
 *
 * `VOCAB_MEANINGS_ASSET` is a **measurement and operations knob, not a
 * deployment option.** Unset — the default — it is the production asset path and
 * the fully correct production behaviour; **nothing depends on it being set**,
 * and it must not be made required. Setting it is for verification only: pointing
 * it at a file that does not exist makes the page ship no meanings at all, which
 * is how the acceptance run measures the page with and without this payload in
 * one window on one build. Because an absent asset sends nothing extra, that page
 * is byte-for-byte the page from before this feature existed, so the two passes
 * differ only by this payload.
 *
 * The result is cached, so a server running while the asset is rebuilt keeps the
 * old one until it restarts.
 */
const assetPath = process.env.VOCAB_MEANINGS_ASSET ?? path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.json");

let cached: MeaningAsset | null = null;

export function loadLrMeaningAsset(): MeaningAsset {
  if (cached) return cached;
  try {
    cached = parseMeaningAsset(JSON.parse(readFileSync(assetPath, "utf8")));
  } catch {
    cached = { available: false, order: null, meanings: {} };
  }
  return cached;
}
