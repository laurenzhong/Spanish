/**
 * Where the vocabulary shelf's form counts come from.
 *
 * The shelf needs two facts about the published corpus: how often each surface
 * form occurs, and one real segment it occurs in. Both are produced by one
 * aggregate over every visible segment — 109,211 texts on the real corpus, which
 * costs ~1.0 s just to read and ~1.4 s with the tokenising fold. That is the
 * floor of the live scan, so the numbers are materialised into
 * `lexicon_form_frequencies` and the cold path reads the table instead.
 *
 * ## One visibility predicate, physically
 *
 * {@link visibleCorpusFormCtes} is the only definition of "visible":
 * `source_texts` (published media versions + published, copyright-cleared
 * article versions, `user_generated_articles` excluded), plus the `tokens` and
 * `folded` steps that turn it into countable forms. The live query and the
 * refresh are both built from that same value, so a divergence between the
 * counts the shelf computes and the counts the table stores is not something a
 * reviewer has to notice — there is only one place to change. The tests still
 * prove the behaviour on both paths (a second predicate added *around* this
 * fragment would not be caught by construction alone).
 *
 * ## Staleness is bounded, observable, and enforced
 *
 * Publishing or withdrawing content does not refresh anything by itself; the
 * refresh is `scripts/refresh-frequency-forms.ts`, which the content pipeline
 * should run (nightly is the documented cadence). Between runs the table is
 * stale, and that is visible in three places:
 *
 * - `lexicon_form_frequency_state` holds `refreshed_at` and `form_count`;
 * - every cold load logs which source served it and how old the refresh is;
 * - past {@link MATERIALISED_FREQUENCY_MAX_AGE_MS} the read path stops trusting
 *   the table and returns the exact live numbers instead. The bound is therefore
 *   real rather than aspirational: counts are never more than that age out of
 *   date, because beyond it the shelf is slow again instead of wrong.
 *
 * ## Empty or un-refreshed is never "zero"
 *
 * A missing state row, an empty table, or a table written before the migration
 * was applied all mean the same thing to the read path: fall back to the live
 * scan. Reporting the materialised table's emptiness as zero occurrences would
 * be a silent lie about the corpus; this cannot happen because the read
 * distinguishes those states inside the same statement (see
 * {@link readMaterialisedFormFrequencyRows}) instead of inferring them from an
 * empty result.
 */

import { sql } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import { contentFrequencyWords } from "../domain/frequency-word-list";
import { normalizeSpanishSurface } from "../domain/spanish-token";

/** The switch that picks the source. Named for what it selects, not for a boolean. */
export const LEXICON_FREQUENCY_SOURCE_ENV_KEY = "LEXICON_FREQUENCY_SOURCE" as const;

export const corpusFrequencySourceValues = ["materialised", "live"] as const;
export type CorpusFrequencySource = (typeof corpusFrequencySourceValues)[number];

/**
 * The default is the fast path.
 *
 * Unlike a feature that can be wrong when enabled by accident, this one has a
 * built-in escape: a table that was never refreshed, is empty, or has grown
 * older than the cap falls back to the live scan. There is no correctness reason
 * to default to the 3-second query, so the default is the one the task exists to
 * ship; `live` is the explicit opt-out used for A/B measurement and as a kill
 * switch.
 */
export const DEFAULT_CORPUS_FREQUENCY_SOURCE: CorpusFrequencySource = "materialised";

/**
 * How old a refresh may be before the read path stops using it.
 *
 * The documented refresh cadence is nightly, so a healthy deployment sits around
 * 24 h (+ the refresh duration) at worst. 36 h leaves room for one missed run
 * without flapping, and turns "we forgot to refresh" from silent staleness into
 * a slow-but-correct shelf plus a logged warning.
 */
export const MATERIALISED_FREQUENCY_MAX_AGE_MS = 36 * 60 * 60 * 1_000;

export function resolveCorpusFrequencySource(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CorpusFrequencySource {
  const configured = environment[LEXICON_FREQUENCY_SOURCE_ENV_KEY]?.trim().toLowerCase();
  return configured === "live" || configured === "materialised" ? configured : DEFAULT_CORPUS_FREQUENCY_SOURCE;
}

/**
 * One row of the aggregate, in the shape the shelf consumes: the folded form,
 * its occurrence count, and the `[text, title]` pair the live scan's
 * `min(array[text, title])` picked.
 */
export type FormFrequencyRow = Readonly<{
  word: string;
  n: number;
  example: readonly string[];
}>;

/**
 * Unwrap a raw `execute()` result.
 *
 * The production postgres-js driver returns rows directly, while drizzle's
 * PGlite driver returns `{ rows, fields }` — and a transaction handle is not the
 * proxied database a test may have wrapped. Normalising here keeps every caller
 * (repository, scripts, tests) from having to know which driver it holds.
 */
function unwrapRows<T>(result: unknown): readonly T[] {
  if (Array.isArray(result)) return result as readonly T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as readonly T[]) : [];
}

/**
 * The visible corpus, tokenised and folded — the single definition of both the
 * visibility rule and the token/fold rule.
 *
 * Exported so a test can render it through the dialect and assert that both
 * statements below contain it verbatim: a hand-written predicate added to
 * either one fails that check rather than silently disagreeing.
 *
 * `regexp_split_to_table` splits straight on the separator class (one regex pass
 * instead of replace-then-split) and its empty pieces are dropped by the
 * `length(word) >= 2` filter the callers apply. The fold is `translate`, which
 * must stay equivalent to `normalizeSpanishSurface` in JS: the tokenizer only
 * ever emits `[a-záéíóúüñ]`, and NFKD + stripping combining marks maps exactly
 * `áéíóúü` to `aeiou` and `ñ` to `n`.
 */
export const visibleCorpusFormCtes = sql`source_texts as (
      select ms.source_text as text, mv.title as title
      from ${schema.mediaSegments} ms
      inner join ${schema.mediaVersions} mv on mv.id = ms.media_version_id
      where ms.review_status = 'approved' and mv.status = 'published' and mv.copyright_status = 'cleared'
      union all
      select seg.source_text, av.title
      from ${schema.articleSegments} seg
      inner join ${schema.articleVersions} av on av.id = seg.article_version_id
      inner join ${schema.articleSources} src on src.id = av.source_id
      where av.status = 'published' and src.copyright_status = 'cleared'
        and not exists (select 1 from ${schema.userGeneratedArticles} uga where uga.article_version_id = av.id)
    ), tokens as (
      select regexp_split_to_table(lower(text), '[^a-záéíóúüñ]+') as word, text, title
      from source_texts
    ), folded as (
      select translate(word, 'áéíóúüñ', 'aeiouun') as word, text, title
      from tokens
    )`;

/**
 * The reference-list forms, folded and space-joined into the one parameter the
 * live query filters on. A single parameter rather than a 7.9k-value `IN (...)`
 * list: drizzle expands a JS array into one placeholder per element, and the
 * single parameter measured no slower while keeping the statement small.
 */
export function wantedFormList(): string {
  return [...new Set(contentFrequencyWords().map((entry) => normalizeSpanishSurface(entry.word)))].join(" ");
}

/**
 * The live scan: one statement, the whole published corpus, filtered to the
 * forms the shelf can display.
 *
 * This is the reference implementation of the counts. The refresh below is the
 * same aggregate without the form filter, so the two cannot disagree about what
 * visible means.
 */
export async function loadLiveFormFrequencyRows(database: Database): Promise<readonly FormFrequencyRow[]> {
  const wantedForms = wantedFormList();
  return unwrapRows<FormFrequencyRow>(await database.execute(sql`
    with ${visibleCorpusFormCtes}
    select word, count(*)::int as n, min(array[text, title]) as example
    from folded
    where word = any(string_to_array(${wantedForms}, ' '))
    group by word
  `));
}

/** Why the materialised table could not be used, or `ok` when it could. */
export type MaterialisedFrequencyRead =
  | Readonly<{ status: "ok"; refreshedAt: Date; rows: readonly FormFrequencyRow[] }>
  | Readonly<{ status: "no_state" | "empty_table" }>;

function asDate(value: unknown): Date | null {
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Read the materialised rows for the given forms — one statement, always.
 *
 * The statement reports its own usability in the same result set, which is what
 * keeps the cold path at exactly one query on the fast branch: a sentinel row
 * (with a null `word`) says whether the table was ever refreshed and whether it
 * still has rows. Inferring that from an empty result would confuse "this page's
 * words are not in the corpus" — which is normal and means zero occurrences —
 * with "the table is not usable", which must fall back to the live scan.
 *
 * The result columns are the same facts the live scan returns, in the same
 * order, so a caller cannot tell the two apart by shape.
 */
export async function readMaterialisedFormFrequencyRows(
  database: Database,
  wantedForms: string,
): Promise<MaterialisedFrequencyRead> {
  const rows = unwrapRows<{
    status: string;
    refreshed_at: unknown;
    word: string | null;
    occurrence_count: number | null;
    example_text: string | null;
    example_title: string | null;
  }>(await database.execute(sql`
    with state as (
      select refreshed_at from ${schema.lexiconFormFrequencyState} where id = 'corpus'
    )
    select 'ok'::text as status, (select refreshed_at from state) as refreshed_at,
           f.word, f.occurrence_count, f.example_text, f.example_title
    from ${schema.lexiconFormFrequencies} f
    where f.word = any(string_to_array(${wantedForms}, ' '))
    union all
    select
      case
        when (select refreshed_at from state) is null then 'no_state'
        when not exists (select 1 from ${schema.lexiconFormFrequencies}) then 'empty_table'
        else 'ok'
      end,
      (select refreshed_at from state),
      null::text, null::int, null::text, null::text
  `));

  const sentinel = rows.find((row) => row.word === null);
  if (!sentinel) {
    // No sentinel can only mean the statement shape changed; treating it as
    // "usable with no rows" would silently zero the shelf.
    return { status: "empty_table" };
  }
  if (sentinel.status !== "ok") {
    return { status: sentinel.status === "empty_table" ? "empty_table" : "no_state" };
  }
  const refreshedAt = asDate(sentinel.refreshed_at);
  if (!refreshedAt) return { status: "no_state" };

  const materialised: FormFrequencyRow[] = [];
  for (const row of rows) {
    if (row.word === null) continue;
    materialised.push({
      word: row.word,
      n: Number(row.occurrence_count ?? 0),
      example: [
        typeof row.example_text === "string" ? row.example_text : "",
        typeof row.example_title === "string" ? row.example_title : "",
      ],
    });
  }
  return { status: "ok", refreshedAt, rows: materialised };
}

/**
 * Replace the materialised table with a fresh aggregate, atomically.
 *
 * One transaction holds the delete, the insert and the state row, so a reader
 * sees the previous complete set or the new complete set — never a half-built
 * table, and never rows whose `refreshed_at` disagrees with them. Re-running it
 * is idempotent: the same corpus produces the same rows and a new timestamp.
 */
export async function refreshCorpusFormFrequency(
  database: Database,
  now: Date = new Date(),
): Promise<Readonly<{ forms: number; refreshedAt: Date }>> {
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`delete from ${schema.lexiconFormFrequencies}`);
    const written = unwrapRows<{ forms: number }>(await transaction.execute(sql`
      with ${visibleCorpusFormCtes}, grouped as (
        select word, count(*)::int as n, min(array[text, title]) as example
        from folded
        where length(word) >= 2
        group by word
      ), inserted as (
        insert into ${schema.lexiconFormFrequencies} (word, occurrence_count, example_title, example_text)
        select word, n, (example)[2], (example)[1] from grouped
        returning 1
      )
      select count(*)::int as forms from inserted
    `));
    const forms = Number(written[0]?.forms ?? 0);
    // An ISO string plus an explicit cast, not a JS Date: drizzle's query builder
    // maps Dates through the column type, but a raw sql-template parameter is
    // handed to the driver as-is and postgres.js rejects a Date there. PGlite
    // accepts both, so only a run against the real database surfaces this.
    await transaction.execute(sql`
      insert into ${schema.lexiconFormFrequencyState} (id, refreshed_at, form_count)
      values ('corpus', ${now.toISOString()}::timestamptz, ${forms})
      on conflict (id) do update set refreshed_at = excluded.refreshed_at, form_count = excluded.form_count
    `);
    return { forms, refreshedAt: now };
  });
}

/** The last refresh, or `null` when the materialisation has never run. */
export async function readCorpusFormFrequencyState(
  database: Database,
): Promise<Readonly<{ refreshedAt: Date; formCount: number }> | null> {
  const rows = unwrapRows<{ refreshed_at: unknown; form_count: number }>(await database.execute(sql`
    select refreshed_at, form_count from ${schema.lexiconFormFrequencyState} where id = 'corpus'
  `));
  const row = rows[0];
  if (!row) return null;
  const refreshedAt = asDate(row.refreshed_at);
  return refreshedAt ? { refreshedAt, formCount: Number(row.form_count ?? 0) } : null;
}

export type FormFrequencyLoad = Readonly<{
  rows: readonly FormFrequencyRow[];
  /** Which source actually served this load. */
  source: CorpusFrequencySource;
  /** `null` on the fast path; otherwise why the live scan was used. */
  fallback: string | null;
  /** Age of the refresh that was accepted, or `null` when the live scan served. */
  refreshedAt: Date | null;
}>;

function describeAge(ageMs: number): string {
  return `${(ageMs / 3_600_000).toFixed(1)}h`;
}

/**
 * Produce the aggregate rows for one cold load, from the configured source.
 *
 * The fallback is deliberately a *second* statement rather than a clever union:
 * keeping the live aggregate out of the materialised statement means the fast
 * path cannot accidentally execute the 109k-segment scan, and the extra query
 * only happens on the paths that were going to be slow anyway (never refreshed,
 * emptied, stale, or a database that predates the migration). The cold-path
 * tests pin both counts — one statement on the fast branch, two on the fallback.
 */
export async function loadFormFrequencyRows(
  database: Database,
  options: Readonly<{ source?: CorpusFrequencySource; now?: number }> = {},
): Promise<FormFrequencyLoad> {
  const source = options.source ?? resolveCorpusFrequencySource();
  const now = options.now ?? Date.now();
  const wantedForms = wantedFormList();

  if (source === "live") {
    const rows = await loadLiveFormFrequencyRows(database);
    return { rows, source: "live", fallback: null, refreshedAt: null };
  }

  let read: MaterialisedFrequencyRead | null = null;
  let failure: string | null = null;
  try {
    read = await readMaterialisedFormFrequencyRows(database, wantedForms);
  } catch (error) {
    // A database that predates migration 0043 fails here. That is a deploy that
    // is out of order, not a reason to fail the page: the live scan is correct.
    failure = `unavailable: ${String((error as { cause?: unknown }).cause ?? error).slice(0, 120)}`;
  }

  if (read && read.status === "ok") {
    const ageMs = now - read.refreshedAt.getTime();
    if (ageMs <= MATERIALISED_FREQUENCY_MAX_AGE_MS) {
      console.log(
        `[frequency] materialised snapshot: ${read.rows.length} form row(s), refreshed ${describeAge(Math.max(0, ageMs))} ago`,
      );
      return { rows: read.rows, source: "materialised", fallback: null, refreshedAt: read.refreshedAt };
    }
    failure = `stale: refreshed ${describeAge(ageMs)} ago, cap is ${describeAge(MATERIALISED_FREQUENCY_MAX_AGE_MS)}`;
  } else if (read) {
    failure = read.status === "empty_table" ? "empty table" : "never refreshed";
  }

  const rows = await loadLiveFormFrequencyRows(database);
  console.log(`[frequency] live scan (${failure ?? "unknown"}); ${rows.length} form row(s)`);
  return { rows, source: "live", fallback: failure, refreshedAt: null };
}
