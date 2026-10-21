/**
 * Reading one word's example address for read-aloud.
 *
 * The vocabulary shelf's cold path already reads every form's address (see
 * `corpus-form-frequency.ts`), but the shelf page does not need to carry those
 * addresses into the browser: a click sends the word, and this module answers
 * with the address on the server. That keeps the client from choosing which
 * media a word plays, and keeps the shelf's payload unchanged.
 *
 * One cached statement serves many clicks. The cache is short-lived and holds no
 * user data — the corpus visibility rule and the materialised staleness bound are
 * already applied by `loadFormFrequencyRows` — so a click costs a lookup in a map
 * rather than a 109k-segment scan.
 */

import type { Database } from "@/src/shared/db/client";

import { normalizeSpanishSurface } from "../domain/spanish-token";
import { loadFormFrequencyRows, readMaterialisedFormFrequencyRows, wantedFormList, type FormFrequencyRow } from "./corpus-form-frequency";
import type { ExampleAddress } from "../application/resolve-word-audio";

/**
 * How long a loaded address map may serve clicks.
 *
 * The underlying materialised table has its own documented staleness bound (36 h)
 * and the live fallback is exact, so this only avoids re-reading the same rows
 * several times while a reader hovers around one shelf. Ten minutes matches the
 * process-level cache the shelf's own snapshot already uses.
 */
export const WORD_ADDRESS_TTL_MS = 10 * 60 * 1_000;

type AddressCache = Readonly<{ loadedAt: number; byWord: ReadonlyMap<string, ExampleAddress> }>;

let addressCache: AddressCache | null = null;
let addressInFlight: Promise<AddressCache> | null = null;

function toAddress(row: FormFrequencyRow): ExampleAddress | null {
  const [exampleText, , documentKind, documentStableKey, documentVersion, segmentIndex] = row.example;
  if (typeof exampleText !== "string" || exampleText.length === 0) return null;
  return {
    word: row.word,
    exampleText,
    documentKind,
    documentStableKey,
    documentVersion,
    segmentIndex,
  };
}

function buildAddressMap(rows: readonly FormFrequencyRow[]): AddressCache {
  const byWord = new Map<string, ExampleAddress>();
  for (const row of rows) {
    // Same fold the shelf and the token index use, so a word the reader clicked
    // resolves to the row the shelf rendered under it.
    const normalized = normalizeSpanishSurface(row.word);
    if (normalized.length === 0) continue;
    const address = toAddress(row);
    if (address) byWord.set(normalized, { ...address, word: normalized });
  }
  return { loadedAt: Date.now(), byWord };
}

/**
 * The addresses for the given words, loaded once per TTL.
 *
 * Exported for tests and for callers that need the whole map (a page that wants
 * to know which words have audio before any click).
 */
export async function loadWordAddresses(database: Database, now = Date.now()): Promise<ReadonlyMap<string, ExampleAddress>> {
  if (addressCache && now - addressCache.loadedAt < WORD_ADDRESS_TTL_MS) return addressCache.byWord;
  if (addressInFlight) return (await addressInFlight).byWord;
  // Only the shelf's own forms. The materialised table holds every form in the
  // corpus (about 63k against the shelf's 6.3k), and a click can only ever be on a
  // shelf word, so loading the rest would be ten times the work for rows nothing
  // can ask about.
  const shelfForms = new Set(wantedFormList().split(" "));
  addressInFlight = loadFormFrequencyRows(database)
    .then((load) => buildAddressMap(load.rows.filter((row) => shelfForms.has(row.word))))
    .then((cache) => {
      addressCache = cache;
      return cache;
    })
    .finally(() => {
      addressInFlight = null;
    });
  return (await addressInFlight).byWord;
}

/**
 * The address of one word, or `null` when the corpus has no example for it.
 *
 * Reads *that word's row* rather than the whole shelf's addresses. The table is keyed by
 * the folded form, so passing one form to the materialised read is a primary-key lookup;
 * loading all ~6.3k shelf forms to answer about one word measured as the residual cost of
 * a click after the media read was narrowed. The bulk loader stays for callers that need
 * the whole map.
 *
 * There is no `now` parameter: the single-word read is not cached, so there is no age to
 * compare against. The bulk loader keeps its own TTL.
 */
export async function findWordAddress(database: Database, word: string): Promise<ExampleAddress | null> {
  const key = normalizeSpanishSurface(word);
  if (!key) return null;
  const read = await readMaterialisedFormFrequencyRows(database, key);
  if (read.status !== "ok") return null;
  const row = read.rows.find((candidate) => candidate.word === key);
  if (!row) return null;
  const address = toAddress(row);
  return address ? { ...address, word: key } : null;
}

/** Test seam: forget the cached map so the next call re-reads the corpus. */
export function resetWordAddressCache(): void {
  addressCache = null;
  addressInFlight = null;
}
