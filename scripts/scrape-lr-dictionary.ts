/**
 * Scrape Language Reactor's hover dictionary for the shelf's word list.
 *
 * The vocabulary shelf shows a Chinese gloss per word. Until now those glosses
 * came from our own generation pipeline, which needs two review calls per
 * candidate; the owner instead authorised importing Language Reactor's
 * ready-made dictionary data, which is what this script fetches.
 *
 * What it is and is not:
 *
 * - it reads the committed reference list (`contentFrequencyWords()`), so the
 *   word set is exactly what the shelf displays — 7,922 forms after the
 *   function-word filter;
 * - it records **one line per word** in `es-meanings-v1.raw.jsonl`: the exact
 *   URL parameters, the timestamp, the HTTP status, and the raw response body.
 *   That record is the licence/provenance evidence `AGENTS.md` §8 requires, and
 *   it is written before the curated asset exists;
 * - it makes **no claim about frequency**. LR's hover dictionary returns no
 *   frequency field, so its order is stored as LR's order and nothing else;
 * - a miss (bare HTTP 400, indistinguishable from a malformed request) is
 *   recorded as `miss` and **never retried**; only transport failures and 5xx
 *   are retried, with backoff;
 * - it is resumable: words already recorded are skipped, so an interrupted run
 *   continues where it stopped instead of re-fetching.
 *
 * Pacing: ~1.5 requests/second (550 ms plus jitter). The scout measured
 * 1.66 req/s sustained with zero 429s, and repeating one URL is CDN-cached, so
 * this walks the word list in order rather than hammering a single form.
 *
 * Run:
 *   node --conditions=react-server --import tsx/esm scripts/scrape-lr-dictionary.ts
 *   node --conditions=react-server --import tsx/esm scripts/scrape-lr-dictionary.ts --limit=25 --pace=200
 */
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

import { contentFrequencyWords } from "../src/modules/lexicon-corpus/domain/frequency-word-list";

const ENDPOINT = "https://api-cdn-plus.dioco.io/base_dict_getHoverDict_8";

/**
 * The parameters the owner supplied from Language Reactor's own UI request,
 * verified live before this run: `lemma` empty and `pos=ANY` (not an empty
 * string) — the two differences from the scout's earlier probe.
 */
const QUERY = { lemma: "", sl: "es", tl: "zh-CN", pos: "ANY", pow: "n" } as const;

const RAW_PATH = path.join(process.cwd(), "content", "word-lists", "es-meanings-v1.raw.jsonl");
const BASE_PACE_MS = 550;
const JITTER_MS = 120;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20_000;
const PROGRESS_EVERY = 100;

const args = process.argv.slice(2);
const limit = Number(args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? 0);
const paceMs = Number(args.find((arg) => arg.startsWith("--pace="))?.slice("--pace=".length) ?? BASE_PACE_MS);
/**
 * How many consecutive 429s end the pass.
 *
 * A pass that is being throttled would otherwise spend its whole slice asking a
 * CDN that is refusing; stopping early leaves those words pending for the next
 * pass, and a small value makes a "is the window open again?" probe cheap.
 */
const throttleStop = Number(args.find((arg) => arg.startsWith("--throttle-stop="))?.slice("--throttle-stop=".length) ?? 25);

type Outcome = "found" | "partial" | "miss" | "throttled" | "unexpected" | "error";

type RawRecord = Readonly<{
  word: string;
  listRank: number;
  fetchedAt: string;
  httpStatus: number | null;
  outcome: Outcome;
  /** Confirmed retries that preceded this record, for the audit trail. */
  attempts: number;
  url: string;
  raw: string;
}>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

function buildUrl(word: string): string {
  const params = new URLSearchParams({ form: word, ...QUERY });
  return `${ENDPOINT}?${params.toString()}`;
}

/**
 * One fetch with retries.
 *
 * A 400 is the miss the owner described: the endpoint answers it both for a word
 * it does not carry and for a request it cannot parse, so retrying would just
 * repeat the same unhelpful answer.
 *
 * A 429 is **not retried here** either. Retrying inside the pass turned a
 * throttled window into ~30 s per word (three attempts with 5/10/15 s backoff)
 * and made the whole run slower than simply letting the word wait for the next
 * pass — the slice driver's cooldown is the right place for that backoff. The
 * word is recorded as `throttled` and picked up again on the next pass.
 */
async function fetchWord(
  word: string,
): Promise<Readonly<{ httpStatus: number | null; body: string; attempts: number; transportError: string | null }>> {
  const url = buildUrl(word);
  let lastStatus: number | null = null;
  let lastBody = "";
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      lastStatus = response.status;
      lastBody = await response.text();
      if (response.status === 200 || response.status === 400 || response.status === 429) {
        return { httpStatus: response.status, body: lastBody, attempts: attempt, transportError: null };
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = String((error as { cause?: unknown }).cause ?? error).slice(0, 200);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(1_000 * attempt);
  }
  return { httpStatus: lastStatus, body: lastBody, attempts: MAX_ATTEMPTS, transportError: lastError };
}

/** Read what a previous run already recorded, so an interrupted run resumes. */
async function alreadyRecorded(): Promise<ReadonlySet<string>> {
  try {
    const body = await readFile(RAW_PATH, "utf8");
    const done = new Set<string>();
    for (const line of body.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as RawRecord;
        // `error` and `throttled` records are not trusted as final: a transport
        // failure or a 429 deserves another try on the next pass, unlike a 400
        // miss or a word that was answered.
        if (record.outcome !== "error" && record.outcome !== "throttled") done.add(record.word);
      } catch {
        // A torn last line from an interrupt is ignored; that word is re-fetched.
      }
    }
    return done;
  } catch {
    return new Set<string>();
  }
}

/** The `hoverDictEntries` array, or `null` when the body does not carry one. */
function entriesOf(body: string): readonly string[] | null {
  try {
    const parsed = JSON.parse(body) as { data?: { hoverDictEntries?: unknown } };
    const entries = parsed.data?.hoverDictEntries;
    return Array.isArray(entries) && entries.every((entry) => typeof entry === "string")
      ? (entries as readonly string[])
      : null;
  } catch {
    return null;
  }
}

function classify(httpStatus: number | null, body: string): Readonly<{ outcome: Outcome; detail: string }> {
  if (httpStatus === 429) return { outcome: "throttled", detail: "HTTP 429" };
  if (httpStatus === 200) {
    const entries = entriesOf(body);
    return entries
      ? { outcome: "found", detail: "" }
      : { outcome: "unexpected", detail: "200 without a hoverDictEntries array of strings" };
  }
  if (httpStatus === 400) {
    // Not every 400 is a miss. LR answers 400 with `error: "PARTIAL_DATA"` *and* a
    // usable payload for forms its dictionary only half-covers — mostly reflexive
    // verbs, e.g. `morirse` → 死|去世|死亡. Those entries are real translations, so
    // they are kept and reported as `partial` rather than thrown away as a miss. A
    // 400 with no payload is the miss the owner described. Neither is retried.
    const entries = entriesOf(body);
    return entries && entries.length > 0
      ? { outcome: "partial", detail: "" }
      : { outcome: "miss", detail: "" };
  }
  return { outcome: "error", detail: "" };
}

const words = contentFrequencyWords();
console.log("=== Language Reactor dictionary scrape ===");
console.log(`  endpoint    ${ENDPOINT}`);
console.log(`  parameters  ${JSON.stringify(QUERY)}`);
console.log(`  word list   ${words.length} forms (function-word filtered reference list)`);
console.log(`  raw record  ${RAW_PATH}`);
console.log(`  pace        ${paceMs} ms (+0-${JITTER_MS} ms jitter)\n`);

const done = await alreadyRecorded();
// `--limit` caps how many *pending* words this pass fetches, which is what makes
// it useful for probing the rate limit and for finishing a run in slices.
const pendingAll = words.filter((entry) => !done.has(entry.word));
const pending = limit > 0 ? pendingAll.slice(0, limit) : pendingAll;
if (done.size > 0) console.log(`resuming: ${done.size} word(s) already recorded, ${pending.length} to go\n`);

const tally = { found: 0, partial: 0, miss: 0, throttled: 0, unexpected: 0, error: 0 };
let consecutiveThrottles = 0;
let stoppedEarly = false;
const startedAt = Date.now();

for (const [index, entry] of pending.entries()) {
  const fetchedAt = new Date().toISOString();
  const { httpStatus, body, attempts, transportError } = await fetchWord(entry.word);
  const { outcome, detail } = transportError && httpStatus === null
    ? { outcome: "error" as const, detail: transportError }
    : classify(httpStatus, body);

  if (outcome === "throttled") {
    consecutiveThrottles += 1;
  } else {
    consecutiveThrottles = 0;
  }

  tally[outcome] += 1;
  const record: RawRecord & { detail?: string } = {
    word: entry.word,
    listRank: entry.rank,
    fetchedAt,
    httpStatus,
    outcome,
    attempts,
    url: buildUrl(entry.word),
    raw: body.slice(0, 4_000),
    ...(detail ? { detail } : {}),
  };
  await appendFile(RAW_PATH, `${JSON.stringify(record)}\n`, "utf8");

  const processed = index + 1;
  if (processed % PROGRESS_EVERY === 0 || processed === pending.length) {
    const elapsedMinutes = (Date.now() - startedAt) / 60_000;
    const perMinute = processed / Math.max(elapsedMinutes, 0.01);
    const remainingMinutes = (pending.length - processed) / Math.max(perMinute, 0.01);
    console.log(
      `  ${processed}/${pending.length}  found=${tally.found} partial=${tally.partial} miss=${tally.miss} `
        + `throttled=${tally.throttled} unexpected=${tally.unexpected} error=${tally.error}  `
        + `${perMinute.toFixed(0)}/min  eta ${remainingMinutes.toFixed(0)} min`,
    );
  }

  // Throttled: stop the pass rather than keep asking. The driver's cooldown is
  // where the backoff belongs, and every word not answered stays pending.
  if (consecutiveThrottles >= throttleStop) {
    stoppedEarly = true;
    console.log(`\n  stopping this pass: ${consecutiveThrottles} consecutive 429s. Remaining words stay pending.`);
    break;
  }
  await sleep(paceMs + Math.floor(Math.random() * JITTER_MS));
}

console.log("\n=== run complete ===");
console.log(`  fetched this run  ${pending.length}`);
console.log(`  found             ${tally.found}`);
console.log(`  partial (400 + data) ${tally.partial}`);
console.log(`  miss (400, no data)  ${tally.miss}`);
console.log(`  throttled (429)   ${tally.throttled}`);
console.log(`  unexpected (200)  ${tally.unexpected}`);
console.log(`  error             ${tally.error}`);
console.log(`  stopped early     ${stoppedEarly}`);
console.log(`  elapsed           ${((Date.now() - startedAt) / 60_000).toFixed(1)} min`);
console.log(`  raw record        ${RAW_PATH}`);
console.log(
  "\nnothing has been imported yet: this file is the evidence. The curated asset and its\n"
    + "provenance are produced by scripts/build-lr-meaning-asset.ts, which filters and reports.",
);
