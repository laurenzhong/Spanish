/**
 * Turn the raw Language Reactor scrape into a curated asset plus its provenance.
 *
 * Input:  content/word-lists/es-meanings-v1.raw.jsonl  (one line per word: the
 *         exact URL, parameters, timestamp, HTTP status and raw response)
 * Output: content/word-lists/es-meanings-v1.json       (the asset)
 *         content/word-lists/es-meanings-v1.provenance.json (the record)
 *
 * Three rules this script exists to enforce:
 *
 * 1. **No frequency claim.** LR's hover dictionary returns no frequency field, so
 *    the translations are stored in LR's order and labelled as such
 *    (`order: "language-reactor-hover-dictionary"`). There is no `rank` on any
 *    entry — an array index is not a rank, and we cannot source one from this
 *    endpoint. A real rank would need LR's `base_dict_llmDict`, which requires
 *    the owner's session.
 * 2. **Untranslated entries are dropped, not imported.** For `tl=zh-CN` a
 *    translation must contain a CJK ideograph; an entry that is the Spanish form
 *    (or its plural/feminine variant) is not a translation. Every drop is
 *    counted and exemplified in the provenance.
 * 3. **A miss is not an empty meaning.** A word LR does not carry is listed in
 *    the provenance and left out of the asset entirely, so nothing downstream can
 *    render "no meaning" as a meaning.
 *
 * The asset is written with `status: "draft"` and `reviewed: false`: importing
 * third-party data does not satisfy `AGENTS.md` §8's review discipline, which is
 * a separate decision the owner has not made yet.
 *
 * Run: node --conditions=react-server --import tsx/esm scripts/build-lr-meaning-asset.ts
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { contentFrequencyWords } from "../src/modules/lexicon-corpus/domain/frequency-word-list";

const RAW_PATH = path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.raw.jsonl");
const ASSET_PATH = path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.json");
const PROVENANCE_PATH = path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.provenance.json");

const ENDPOINT = "https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8";
const QUERY = { lemma: "", sl: "es", tl: "zh-CN", pos: "ANY", pow: "n" } as const;

/** A CJK ideograph, i.e. evidence that `zh-CN` was actually answered. */
const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u;

type RawRecord = Readonly<{
  word: string;
  listRank: number;
  fetchedAt: string;
  httpStatus: number | null;
  /**
   * `throttled` is a real outcome, not a hypothetical: the scraper records it for
   * HTTP 429 (see `classify` in `scrape-lr-dictionary.ts`), and both the
   * first-real-answer-wins rule above and the `throttledWords` tally below branch
   * on it. It was missing from this union, which made those two branches look
   * like dead comparisons to the type checker even though they are live at
   * runtime, because records arrive through `JSON.parse` and so were never
   * narrowed. Adding it here is the fix; narrowing the comparisons would have
   * deleted working behaviour to satisfy the compiler.
   */
  outcome: "found" | "partial" | "miss" | "unexpected" | "error" | "throttled";
  attempts: number;
  url: string;
  raw: string;
  detail?: string;
}>;

/**
 * The `hoverDictEntries` array a response carries, or `null`.
 *
 * The array is read from the raw body rather than from the recorded `outcome`,
 * because a `400` is not automatically a miss: LR answers `400` with
 * `error: "PARTIAL_DATA"` *and* a usable payload for forms its dictionary only
 * half-covers (mostly reflexive verbs, e.g. `morirse` → 死|去世|死亡). Records
 * written by the earlier scraper revision labelled those as `miss`, and
 * reclassifying here means the difference is recoverable from the evidence
 * instead of needing a second scrape.
 */
function entriesIn(raw: string): readonly string[] | null {
  try {
    const parsed = JSON.parse(raw) as { data?: { hoverDictEntries?: unknown } };
    const entries = parsed.data?.hoverDictEntries;
    return Array.isArray(entries) && entries.every((entry) => typeof entry === "string")
      ? (entries as readonly string[])
      : null;
  } catch {
    return null;
  }
}

const raw = await readFile(RAW_PATH, "utf8");
const records: RawRecord[] = [];
let tornLines = 0;
for (const line of raw.split("\n")) {
  if (!line.trim()) continue;
  try {
    records.push(JSON.parse(line) as RawRecord);
  } catch {
    tornLines += 1;
  }
}

const listWords = contentFrequencyWords();
const recordByWord = new Map<string, RawRecord>();
for (const record of records) {
  const existing = recordByWord.get(record.word);
  // A record that carries no answer (`error`, `throttled`) is replaced by any
  // later attempt; the first real answer wins.
  if (!existing || existing.outcome === "error" || existing.outcome === "throttled") {
    recordByWord.set(record.word, record);
  }
}

type DropExample = Readonly<{ word: string; entry: string; reason: string }>;

const meanings: Record<string, readonly string[]> = {};
const dropped: DropExample[] = [];
const droppedByReason = new Map<string, number>();
const noUsableTranslation: string[] = [];
const missed: { word: string; httpStatus: number | null; outcome: string; detail?: string }[] = [];
const unexpected: { word: string; detail?: string }[] = [];
const partial: { word: string; httpStatus: number; entries: number }[] = [];
/**
 * Words with no final answer: throttled (429), transport failures, or not
 * reached yet. Kept apart from `missed`, which means "the endpoint answered and
 * had nothing" — conflating the two would overstate the real miss rate.
 */
const unresolved: { word: string; outcome: string; httpStatus: number | null; detail?: string }[] = [];
const throttledWords: { word: string; httpStatus: number }[] = [];

for (const entry of listWords) {
  const record = recordByWord.get(entry.word);
  if (!record) {
    unresolved.push({ word: entry.word, httpStatus: null, outcome: "not-scraped" });
    continue;
  }
  if (record.outcome === "throttled") {
    throttledWords.push({ word: entry.word, httpStatus: record.httpStatus ?? 429 });
    continue;
  }
  if (record.outcome === "error") {
    unresolved.push({
      word: entry.word,
      httpStatus: record.httpStatus,
      outcome: "error",
      ...(record.detail ? { detail: record.detail } : {}),
    });
    continue;
  }

  const entries = entriesIn(record.raw);
  if (entries === null || entries.length === 0) {
    // No payload: a 400 is the miss the owner described, anything else is a
    // response shape we did not expect.
    if (record.httpStatus === 400) {
      missed.push({ word: entry.word, httpStatus: 400, outcome: "miss" });
    } else {
      unexpected.push({ word: entry.word, ...(record.detail ? { detail: record.detail } : {}) });
    }
    continue;
  }
  if (record.httpStatus === 400) {
    // 400 + payload: LR's PARTIAL_DATA answer. The entries are real, so they are
    // imported — and reported separately, because "400" alone would look like a miss.
    partial.push({ word: entry.word, httpStatus: 400, entries: entries.length });
  }

  const kept: string[] = [];
  for (const rawEntry of entries) {
    const candidate = rawEntry.trim();
    if (!candidate) continue;
    if (!cjk.test(candidate)) {
      // Untranslated: the endpoint echoed the Spanish form (or an inflection)
      // instead of a Chinese meaning.
      const reason = candidate.toLocaleLowerCase("es") === entry.word.toLocaleLowerCase("es")
        ? "entry is the Spanish form itself"
        : "entry carries no Chinese characters";
      dropped.push({ word: entry.word, entry: candidate, reason });
      droppedByReason.set(reason, (droppedByReason.get(reason) ?? 0) + 1);
      continue;
    }
    if (kept.includes(candidate)) {
      dropped.push({ word: entry.word, entry: candidate, reason: "duplicate translation" });
      droppedByReason.set("duplicate translation", (droppedByReason.get("duplicate translation") ?? 0) + 1);
      continue;
    }
    kept.push(candidate);
  }

  if (kept.length === 0) {
    noUsableTranslation.push(entry.word);
    continue;
  }
  meanings[entry.word] = kept;
}

const fetchedTimes = records.map((record) => record.fetchedAt).sort();
const rawHash = createHash("sha256").update(raw).digest("hex");

/**
 * Pauses of two minutes or more, read from the timestamps rather than from a
 * hand-written log.
 *
 * The endpoint tolerates roughly 1,800 requests per window and then answers 429
 * until the window refills, so a full run is a series of slices separated by
 * cooldowns; there was also one 65-minute stall in which no requests were made at
 * all. Recording the gaps here means a future reader can tell a deliberate
 * cooldown from a hang without having to trust a summary.
 */
const pauses: { from: string; to: string; minutes: number }[] = [];
const pauseTimes = fetchedTimes.map((time) => Date.parse(time)).sort((left, right) => left - right);
for (let index = 1; index < pauseTimes.length; index += 1) {
  const minutes = (pauseTimes[index] - pauseTimes[index - 1]) / 60_000;
  if (minutes >= 2) {
    pauses.push({
      from: new Date(pauseTimes[index - 1]).toISOString(),
      to: new Date(pauseTimes[index]).toISOString(),
      minutes: Math.round(minutes * 10) / 10,
    });
  }
}
const totalPauseMinutes = Math.round(pauses.reduce((sum, pause) => sum + pause.minutes, 0));
const counts = records.reduce<Record<string, number>>((accumulator, record) => {
  accumulator[record.outcome] = (accumulator[record.outcome] ?? 0) + 1;
  return accumulator;
}, {});

const asset = {
  version: 1,
  locale: "es",
  targetLocale: "zh-CN",
  kind: "meanings",
  status: "draft",
  reviewed: false,
  /**
   * What the order of each `meanings[word]` array means. It is the order the
   * dictionary returned, not a frequency ranking: the endpoint exposes no
   * frequency, and reading its order as frequency is not supported by anything
   * we can cite.
   */
  order: "language-reactor-hover-dictionary",
  source: {
    name: "Language Reactor hover dictionary (api-cdn-plus.dioco.io)",
    endpoint: ENDPOINT,
    parameters: QUERY,
  },
  provenance: "content/word-lists/es-meanings-v1.provenance.json",
  counts: {
    listWords: listWords.length,
    wordsWithMeanings: Object.keys(meanings).length,
    wordsWithoutMeanings: listWords.length - Object.keys(meanings).length,
    droppedEntries: dropped.length,
  },
  meanings,
};

const provenance = {
  asset: "content/word-lists/es-meanings-v1.json",
  source: {
    name: "Language Reactor",
    site: "https://www.language-reactor.com/",
    dictionaryHost: "api-cdn-plus.dioco.io",
    endpoint: ENDPOINT,
    method: "GET",
    parameters: QUERY,
    note:
      "Parameters are the ones Language Reactor's own UI sends, supplied by the owner and verified live: "
      + "lemma is empty and pos=ANY (not an empty string).",
  },
  authorisation: {
    authorisedBy: "project owner",
    authorisedOn: "2026-10-11",
    scope: "one-off scrape of the 7,922-word shelf list for the personal Alpha",
    licence: "unresolved",
    licenceNote:
      "No Dioco terms of service could be located, and Language Reactor's terms page is client-rendered. "
      + "The scrape is recorded here rather than assumed legitimate; resolving the licence is the owner's call. "
      + "AGENTS.md §8 still applies to the imported text: source and licence must be recorded, and this file is that record.",
  },
  fetch: {
    wordsRequested: listWords.length,
    recordsInRawFile: records.length,
    firstFetchedAt: fetchedTimes[0] ?? null,
    lastFetchedAt: fetchedTimes.at(-1) ?? null,
    pacing: "~400 ms between requests plus jitter (measured 1.66 req/s sustained by the scout, zero 429s)",
    outcomes: counts,
    tornLinesIgnored: tornLines,
    pauses: {
      count: pauses.length,
      totalMinutes: totalPauseMinutes,
      note:
        "Gaps of two minutes or more between consecutive requests, derived from the raw record. These are the "
        + "cooldowns between slices, the waits after a throttled slice, and one 65-minute stall in which no "
        + "requests were made (environmental, not a rate limit — normal service resumed afterwards).",
      episodes: pauses,
    },
    throttling: {
      note:
        "The endpoint tolerates roughly 1,800 requests per window and then answers 429 until the window refills "
        + "(measured: clean slices of 450 words, then bursts of 429s). A 429 is recorded as `throttled` and the word "
        + "stays pending for the next slice; it is **not** retried inside a slice, because retrying into a rate "
        + "limit costs ~30 s per word and makes the throttling worse. Full runs are therefore sliced with a cooldown.",
      throttledRecords: counts.throttled ?? 0,
    },
    rawRecord: {
      path: "content/word-lists/es-meanings-v1.raw.jsonl",
      lines: records.length,
      sha256: rawHash,
      contents: "one JSON object per word: word, listRank, fetchedAt, httpStatus, outcome, attempts, url, raw body",
    },
  },
  filtering: {
    rule: "for tl=zh-CN a translation must contain a CJK ideograph; entries that do not are dropped, never imported",
    droppedEntries: dropped.length,
    droppedByReason: Object.fromEntries(droppedByReason),
    droppedExamples: dropped.slice(0, 20),
    wordsLeftWithoutMeanings: noUsableTranslation,
  },
  misses: {
    count: missed.length,
    note:
      "A bare HTTP 400 with no payload is what this endpoint returns both for a word it does not carry and for a "
      + "request it cannot parse, so a 400 is never retried. These words have no entry in the asset — deliberately, "
      + "so nothing downstream can render an absent meaning as a meaning. This is the real miss list.",
    words: missed,
  },
  unresolved: {
    count: unresolved.length + throttledWords.length,
    note:
      "Words with no final answer yet: rate-limited (429), a transport failure, or not reached. They are NOT misses — "
      + "the endpoint never answered — and the scrape resumes them on the next pass. A finished run should leave this "
      + "empty; if it is not empty, the asset is incomplete by exactly these words.",
    notReached: unresolved,
    throttled: throttledWords,
  },
  partialData: {
    count: partial.length,
    note:
      "HTTP 400 whose body still carried `error: \"PARTIAL_DATA\"` **and** usable hoverDictEntries. LR's dictionary "
      + "half-covers these forms (mostly reflexive verbs). The entries are real translations and were imported; they "
      + "are listed here so a 400 is never read as a miss. They are not retried, because a retry returns the same 400.",
    words: partial,
  },
  unexpected: {
    count: unexpected.length,
    note: "HTTP 200 whose body did not carry a hoverDictEntries array of strings.",
    words: unexpected,
  },
  noFrequencyClaim: {
    statement:
      "LR's hover dictionary returns no frequency field. The asset stores LR's order as display order only; "
      + "no entry carries a rank. A real rank would need LR's base_dict_llmDict endpoint, which requires the "
      + "owner's authenticated session and was not used.",
    counterExample:
      "Reading the same order as English frequency is wrong: banco returns 银行|库|长凳, i.e. bank before bench, "
      + "while an English frequency reading would put bench first.",
  },
  reproduce: {
    scrape: "node --conditions=react-server --import tsx/esm scripts/scrape-lr-dictionary.ts",
    build: "node --conditions=react-server --import tsx/esm scripts/build-lr-meaning-asset.ts",
    listSource: "content/word-lists/es-frequency-v1.json filtered by content/word-lists/es-function-words-v1.json",
  },
};

await writeFile(ASSET_PATH, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
await writeFile(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`, "utf8");

console.log("=== Language Reactor meaning asset ===");
console.log(`  list words                 ${listWords.length}`);
console.log(`  raw records                ${records.length} (torn lines ignored: ${tornLines})`);
console.log(`  words with meanings        ${Object.keys(meanings).length}`);
console.log(`  dropped untranslated entries ${dropped.length}  ${JSON.stringify(Object.fromEntries(droppedByReason))}`);
console.log(`  words left without meanings ${noUsableTranslation.length}`);
console.log(`  real misses (400, no payload) ${missed.length}`);
console.log(`  partial data (400 + payload) ${partial.length}`);
console.log(`  unresolved (429/error/unreached) ${unresolved.length + throttledWords.length}`);
console.log(`  unexpected 200s            ${unexpected.length}`);
console.log(`  asset                      ${ASSET_PATH}`);
console.log(`  provenance                 ${PROVENANCE_PATH}`);
console.log(`  raw sha256                 ${rawHash}`);
if (dropped.length > 0) {
  console.log("\n--- dropped entries (first 10) ---");
  for (const example of dropped.slice(0, 10)) console.log(`  ${example.word}: "${example.entry}" (${example.reason})`);
}
if (missed.length > 0) {
  console.log("\n--- misses (first 20) ---");
  console.log(`  ${missed.slice(0, 20).map((item) => item.word).join(", ")}`);
}
