import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parseTatoebaAudio, type TatoebaAudio } from "../domain/tatoeba-audio";

/**
 * Tatoeba's example sentences for the shelf, read once per server process.
 *
 * The asset is built ahead of time by `scripts/build-tatoeba-example-asset.ts`, which
 * is where the fetching, the whole-token and Simplified-Chinese filters, and the
 * licence and author capture happen. This module only reads and validates what that
 * script wrote, so an asset built by an older run cannot put a half-shaped record on
 * screen.
 *
 * Read at runtime rather than imported: like the Language Reactor meanings asset, the
 * file is produced by a separate step, and a static import of a file that may not
 * exist yet would fail the build. An absent or unreadable asset is not an error — every
 * word then simply has no Tatoeba example, which is the honest state of a shelf whose
 * examples have not been fetched.
 *
 * The sentences are third-party content under CC BY 2.0 FR, so every record carries the
 * sentence id, licence and author, plus the translation's own — the licence requires
 * attribution for both, and the panel renders it.
 */
export type TatoebaExample = Readonly<{
  text: string;
  translation: string;
  sentenceId: number;
  sentenceLicense: string | null;
  sentenceOwner: string | null;
  translationId: number;
  translationLicense: string | null;
  translationOwner: string | null;
  isDirect: boolean;
  tags: readonly string[];
  /**
   * The inflected form of the word that this sentence actually contains, when the builder
   * matched a form rather than the bare headword (`Habéis` for `haber`).
   *
   * It exists because a lemma rule means the sentence may not contain the word as the shelf
   * spells it, and a reader looking at `¿Habéis despertado?` under the headword `haber`
   * should be able to see why that sentence is there. Null when the sentence contains the
   * headword itself, or when the asset predates this field.
   */
  matchedForm: string | null;
  /** Whole, unchanged recording with its own licence and attribution. */
  audio?: TatoebaAudio | null;
}>;

export type TatoebaExampleAsset = Readonly<{
  available: boolean;
  /** The licence the asset was built under, surfaced so the UI never hard-codes it. */
  license: string | null;
  sourceUrl: string | null;
  /** Keyed by the accent-folded word, the identity the shelf matches words by. */
  examples: Readonly<Record<string, readonly TatoebaExample[]>>;
}>;

const emptyAsset: TatoebaExampleAsset = { available: false, license: null, sourceUrl: null, examples: {} };

const assetPath = process.env.TATOEBA_EXAMPLES_ASSET
  ?? path.join(process.cwd(), "content", "word-lists", "es-examples-tatoeba-v1.json");

function readExample(value: unknown, audios: Readonly<Record<string, unknown>>): TatoebaExample | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  const translation = typeof record.translation === "string" ? record.translation.trim() : "";
  // Text is the one thing that cannot be optional: an example without a sentence or
  // without its translation is not an example, and a partial one must not reach the UI.
  if (!text || !translation) return null;
  const numberOrNull = (candidate: unknown) => (typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0);
  const stringOrNull = (candidate: unknown) => (typeof candidate === "string" && candidate.trim() ? candidate.trim() : null);
  return {
    text,
    translation,
    sentenceId: numberOrNull(record.sentenceId),
    sentenceLicense: stringOrNull(record.sentenceLicense),
    sentenceOwner: stringOrNull(record.sentenceOwner),
    translationId: numberOrNull(record.translationId),
    translationLicense: stringOrNull(record.translationLicense),
    translationOwner: stringOrNull(record.translationOwner),
    isDirect: record.isDirect === true,
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string") : [],
    // The builder writes the form it matched; a reader that dropped it would leave the
    // panel unable to explain why a sentence that does not contain the headword is shown
    // under it. Absent on assets built before the lemma rule, which is not an error.
    matchedForm: stringOrNull(record.matchedForm),
    audio: parseTatoebaAudio(audios[String(record.sentenceId)] ?? record.audio),
  };
}

export function parseTatoebaExampleAsset(value: unknown, audios: Readonly<Record<string, unknown>> = {}): TatoebaExampleAsset {
  if (!value || typeof value !== "object") return emptyAsset;
  const document = value as { license?: unknown; sourceUrl?: unknown; examples?: unknown };
  if (!document.examples || typeof document.examples !== "object" || Array.isArray(document.examples)) return emptyAsset;
  const examples: Record<string, readonly TatoebaExample[]> = {};
  for (const [word, entry] of Object.entries(document.examples as Record<string, unknown>)) {
    if (!word.trim()) continue;
    // The builder writes `{ word, examples: [...] }` per word — the word is repeated so
    // a reviewer reading the file sees which form each record is for. A bare array is
    // also accepted, because that is the shape this parser originally expected and a
    // reader of either shape should not silently get nothing: an asset that loaded as
    // "available" with zero words is the failure this tolerance is here to prevent.
    const list = Array.isArray(entry)
      ? entry
      : entry && typeof entry === "object" && Array.isArray((entry as { examples?: unknown }).examples)
        ? (entry as { examples: unknown[] }).examples
        : null;
    if (!list) continue;
    const kept = list.map((example) => readExample(example, audios)).filter((example): example is TatoebaExample => example !== null);
    if (kept.length) examples[word] = kept;
  }
  return {
    available: true,
    license: typeof document.license === "string" ? document.license : null,
    sourceUrl: typeof document.sourceUrl === "string" ? document.sourceUrl : null,
    examples,
  };
}

let cached: TatoebaExampleAsset | null = null;
let cachedRevision = "";

function assetRevision(filePath: string): string {
  try {
    const stat = statSync(/* turbopackIgnore: true */ filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch { return "missing"; }
}

export function loadTatoebaExampleAsset(): TatoebaExampleAsset {
  const audioPath = process.env.TATOEBA_AUDIO_ASSET ?? path.join(process.cwd(), "content", "word-lists", "es-audio-tatoeba-v1.json");
  // Rebuilding/removing metadata must take effect without a process restart;
  // otherwise an earlier missing file or a removed recording stays cached forever.
  const revision = `${assetRevision(assetPath)}:${assetRevision(audioPath)}`;
  if (cached && cachedRevision === revision) return cached;
  cachedRevision = revision;
  try {
    // `turbopackIgnore` because the path is dynamic on purpose: the asset is produced by a
    // separate script and may not exist at build time. Without this the bundler traces the
    // whole project to guess what might be read — it says so in the build output ("Dynamic
    // filesystem access causes tracing of the whole project") — and that tracing is what
    // pushed the build into an out-of-memory failure.
    let audios: Record<string, unknown> = {};
    try {
      const metadata = JSON.parse(readFileSync(/* turbopackIgnore: true */ audioPath, "utf8")) as { audios?: unknown };
      if (metadata.audios && typeof metadata.audios === "object" && !Array.isArray(metadata.audios)) audios = metadata.audios as Record<string, unknown>;
    } catch { /* Missing audio metadata leaves the text examples usable. */ }
    cached = parseTatoebaExampleAsset(JSON.parse(readFileSync(/* turbopackIgnore: true */ assetPath, "utf8")), audios);
  } catch {
    cached = emptyAsset;
  }
  return cached;
}
