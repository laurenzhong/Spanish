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

import { sql, type SQL } from "drizzle-orm";

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

/**
 * The display's own limits: how much of an example the shelf may render, and how
 * much of each side it keeps when it clips.
 *
 * They live here rather than next to `buildFrequencyContext` because the query
 * below has to respect them: the clip is only invisible while these two numbers
 * hold, and one definition is what keeps them from drifting apart.
 */
export const FREQUENCY_CONTEXT_MAX_CHARS = 180;
export const FREQUENCY_CONTEXT_EDGE_CHARS = 60;

/**
 * How much raw text to keep on each side of the form when reading an example,
 * and the floor under the window's total width.
 *
 * Both are set from the display's own limits rather than from a measurement that
 * happened to pass:
 *
 * - {@link FREQUENCY_CONTEXT_EDGE_CHARS} is 60, so a side keeps its `…` only if
 *   the window's side normalises to more than 60 characters. Collapsing a
 *   whitespace run removes only the run's *extra* characters, so 120 raw
 *   characters per side normalise to about that many — twice the budget.
 * - The display renders a whole context when the joined text fits in
 *   {@link FREQUENCY_CONTEXT_MAX_CHARS} (180) and clips it otherwise, so the
 *   window must never come back shorter than 180 normalised characters.
 *   {@link FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS} guarantees that even when the form
 *   is the last token in the segment and there is nothing to its right.
 *
 * Measured on the live corpus (the 6,296 rows the shelf reads): 3.80 MB of
 * example text becomes 1.07 MB, and the cold read drops from 2.5-11.5 s to about
 * 1-2.6 s. `tests/database/frequency-example-clip.test.ts` proves the equality on
 * synthetic edges and, when a database is configured, over every shelf row.
 */
export const FREQUENCY_EXAMPLE_MARGIN_CHARS = 120;

/**
 * The narrowest window the clip returns for a segment that is itself longer than
 * the window.
 *
 * Without a floor, a form near the end of a segment produced a window of only
 * `margin + len(form)` characters, which could fall under
 * {@link FREQUENCY_CONTEXT_MAX_CHARS} and send the display down its "render the
 * whole context" branch — a different string from the clipped one the whole
 * segment produces.
 */
export const FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS = 220;

/**
 * The window of `text` the shelf can display, clipped in SQL around the first
 * occurrence of `word` — so the bytes that would be thrown away are never
 * transferred.
 *
 * `word` is the folded form the table and the live scan both key on, so the match
 * is made against the folded text: `translate(lower(...))` here is the same fold
 * as {@link visibleCorpusFormCtes} applies to its tokens (and as
 * `normalizeSpanishSurface` applies in JS). The pattern's boundaries are `[^a-z]`,
 * exactly the tokenizer's separator class after folding, and the position asked
 * for is capture group 2 — the word itself, not the boundary character — so a
 * substring that is not a token (`ser` inside `servir`) cannot anchor the window.
 *
 * Three details keep the window from inventing text the display would believe:
 *
 * - **A segment no longer than the window is returned whole.** Clipping one would
 *   change which branch `buildFrequencyContext` takes and therefore the rendered
 *   string: a 185-character segment whose window came back 131 characters wide
 *   rendered without its `…`.
 * - **The window starts on a word boundary.** Cutting at an arbitrary character
 *   manufactures a token — a real row cut `hermoso` into a leading `oso`, and the
 *   display anchored on that instead of on the actual occurrence 240 characters
 *   in. Snapping the start back to the beginning of the word it landed in costs a
 *   few characters and removes the failure mode outright.
 * - **The window keeps a minimum width**, sliding left when the form sits near the
 *   end of the segment, so it is never narrower than the display's own limit.
 *
 * A form with no token in the text yields position 0, and `substr(text, 1, n)`
 * then returns a bounded prefix: the display finds no token in it either, so it
 * renders `null` exactly as it does today rather than inventing a context.
 */
export function clippedFrequencyExample(
  text: SQL,
  word: SQL,
  margin: number = FREQUENCY_EXAMPLE_MARGIN_CHARS,
): SQL {
  const folded = sql`translate(lower(${text}), 'áéíóúüñ', 'aeiouun')`;
  const position = sql`regexp_instr(${folded}, '(^|[^a-z])(' || ${word} || ')([^a-z]|$)', 1, 1, 0, '', 2)`;
  const anchor = sql`greatest(1, ${position} - ${margin})`;
  // Slide left rather than return a window narrower than the display's limit, and
  // never start mid-word: a window beginning inside a word manufactures a token
  // at its edge, which the display would anchor on instead of the real occurrence.
  const rawStart = sql`least(${anchor}, greatest(1, length(${text}) - ${FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS}))`;
  const start = sql`length(regexp_replace(substr(${folded}, 1, greatest(0, ${rawStart} - 1)), '[a-z]+$', '')) + 1`;
  // The width is measured *from the form*, not from the snapped start: snapping
  // back across a long unbroken run (`xxxx…` around the form) would otherwise
  // spend the window's whole budget on that run and leave the form outside it,
  // which is what `keeps whitespace runs from changing the rendering` caught.
  const width = sql`greatest(${FREQUENCY_EXAMPLE_MIN_WINDOW_CHARS}, ${position} + length(${word}) + ${margin} - ${start} + 1)`;
  return sql`case
      when length(${text}) <= ${width} then ${text}
      else substr(${text}, ${start}, ${width})
    end`;
}

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
  /** `[text, title, documentKind, documentStableKey, documentVersion, segmentIndex]`. */
  example: readonly [string, string, "media" | "article", string | null, number | null, number | null];
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
 * One `example` array as the live scan returns it, typed.
 *
 * The statement builds `array[…]` over text, a case expression and two casts, and
 * the driver does not guarantee one element type across columns: the casts come
 * back as strings while `mv.version` can arrive as a number. The materialised
 * read returns its own columns already typed (`number | null`), so both paths are
 * normalised here rather than at each call site; without this the two paths would
 * compare unequal for reasons that have nothing to do with the corpus, and a
 * numeric version would be dropped as if it were missing.
 */
export function normalizeExampleArray(value: unknown): FormFrequencyRow["example"] {
  const parts = Array.isArray(value) ? value : [];
  const text = (index: number): string => (typeof parts[index] === "string" ? parts[index] : "");
  const nullableText = (index: number): string | null => {
    const raw = parts[index];
    if (typeof raw === "string") return raw;
    return typeof raw === "number" ? String(raw) : null;
  };
  const nullableNumber = (index: number): number | null => {
    const raw = parts[index];
    if (raw === null || raw === undefined || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return [text(0), text(1), parts[2] === "media" ? "media" : "article", nullableText(3), nullableNumber(4), nullableNumber(5)];
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
      select ms.source_text as text, mv.title as title, mv.id as version_id, ms.segment_index as segment_index
      from ${schema.mediaSegments} ms
      inner join ${schema.mediaVersions} mv on mv.id = ms.media_version_id
      where ms.review_status = 'approved' and mv.status = 'published' and mv.copyright_status = 'cleared'
      union all
      select seg.source_text, av.title, av.id, null
      from ${schema.articleSegments} seg
      inner join ${schema.articleVersions} av on av.id = seg.article_version_id
      inner join ${schema.articleSources} src on src.id = av.source_id
      where av.status = 'published' and src.copyright_status = 'cleared'
        and not exists (select 1 from ${schema.userGeneratedArticles} uga where uga.article_version_id = av.id)
    ), tokens as (
      select regexp_split_to_table(lower(text), '[^a-záéíóúüñ]+') as word, text, title, version_id, segment_index
      from source_texts
    ), folded as (
      select translate(word, 'áéíóúüñ', 'aeiouun') as word, text, title, version_id, segment_index
      from tokens
    )`;

/**
 * The one row an aggregate group settled on: the text and title the shelf
 * renders, plus the version uuid and segment index they came from.
 *
 * Resolved by {@link pickedExampleCtes} as a single ordered pass per form, then
 * read by both the live scan and the refresh through this projection, so the two
 * paths cannot disagree about which row won. Two alternative shapes were tried on
 * the real corpus and both are recorded as dead ends, because each looks like the
 * obvious answer:
 *
 * - **A mixed-type array literal** (`array[text, title, version_id, …]`) does not
 *   type-check at all: `ARRAY types text and uuid cannot be matched`.
 * - **Independent aggregates** (`min(text)`, `min(title)`, `min(version_id)`,
 *   `max(segment_index)`) type-check and then pair the media text with the
 *   article title — observed live on the materialisation fixture.
 * - **Four correlated picks per group** is correct but far too slow as a batch:
 *   it re-scans the token set per form and exceeded the database's 300 s bound.
 *
 * The ordering is `(text, title)`, unchanged from the original
 * `min(array[text, title])`: the materialised example clips around the first
 * occurrence of the form inside that text, so "the occurrence with the best
 * audio" must never become the pick.
 *
 * `version_id` is the uuid of the version the example came from — a media version
 * or an article version, which is what {@link visibleCorpusFormCtes} carries; it
 * is `null` for the article branch on purpose. `segment_index` is stored exactly
 * as the source has it (`media_segments.segment_index`, which counts from zero),
 * so a reader can compare it with the playback segments without a conversion
 * step. A one-based display number belongs to whoever renders it, not to this
 * column: an off-by-one applied here would make read-aloud play the neighbouring
 * sentence, which is exactly the class of bug this address exists to prevent.
 */
export function pickedExampleColumns(): SQL {
  return sql`picked.example_text, picked.example_title, picked.example_version_id, picked.example_segment_index`;
}

/**
 * The CTEs that reduce the corpus to one example row per form.
 *
 * `folded_forms` is materialised because it is read three times (the pick, the
 * count and the join); without that the corpus scan — 109k segments, 1.5M tokens
 * — is repeated for each reader. `picked` resolves each form's winner in a single
 * ordered pass (`distinct on (word) … order by word, text, title`, which is the
 * same `(text, title)` rule the original `min(array[text, title])` used), and
 * `example_counts` is the old `count(*) … group by word`.
 *
 * The shape matters for the batch refresh, which is where it was measured: four
 * correlated picks per group (one per column) re-scan the token set per group and
 * blew past the database's 300 s bound on the real corpus, while this one-pass
 * form completes the same aggregate in about 40 s. The two paths must agree row
 * for row, so they share these CTEs verbatim.
 */
export function pickedExampleCtes(): SQL {
  return sql`folded_forms as materialized (
      select word, text, title, version_id, segment_index
      from folded
      where length(word) >= 2
    ), picked as materialized (
      select distinct on (word) word as word, text as example_text, title as example_title,
             version_id as example_version_id, segment_index as example_segment_index
      from folded_forms
      order by word, text, title
    ), example_counts as materialized (
      select word as word, count(*)::int as n
      from folded_forms
      group by word
    )`;
}

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
  const rows = unwrapRows<{ word: string; n: number; example: unknown }>(await database.execute(sql`
    with ${visibleCorpusFormCtes}, ${pickedExampleCtes()}
    select example_counts.word, example_counts.n,
           array[
             ${clippedFrequencyExample(sql`picked.example_text`, sql`example_counts.word`)},
             picked.example_title,
             case when mv.id is null then 'article' else 'media' end,
             mi.stable_key,
             mv.version::text,
             picked.example_segment_index::text
           ] as example
    from example_counts
    join picked on picked.word = example_counts.word
    left join ${schema.mediaVersions} mv on mv.id = picked.example_version_id
    left join ${schema.mediaItems} mi on mi.id = mv.media_item_id
    where example_counts.word = any(string_to_array(${wantedForms}, ' '))
  `));
  return rows.map((row) => ({ word: row.word, n: Number(row.n), example: normalizeExampleArray(row.example) }));
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
    example_document_kind: string | null;
    example_document_stable_key: string | null;
    example_document_version: number | null;
    example_segment_index: number | null;
  }>(await database.execute(sql`
    with state as (
      select refreshed_at from ${schema.lexiconFormFrequencyState} where id = 'corpus'
    )
    select 'ok'::text as status, (select refreshed_at from state) as refreshed_at,
           f.word, f.occurrence_count,
           ${clippedFrequencyExample(sql`f.example_text`, sql`f.word`)} as example_text,
           f.example_title, f.example_document_kind, f.example_document_stable_key,
           f.example_document_version, f.example_segment_index
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
      null::text, null::int, null::text, null::text, null::text, null::text, null::int, null::int
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
        row.example_document_kind === "media" ? "media" : "article",
        typeof row.example_document_stable_key === "string" ? row.example_document_stable_key : null,
        row.example_document_version === null ? null : Number(row.example_document_version),
        row.example_segment_index === null ? null : Number(row.example_segment_index),
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
      with ${visibleCorpusFormCtes}, ${pickedExampleCtes()}, inserted as (
        insert into ${schema.lexiconFormFrequencies}
          (word, occurrence_count, example_title, example_text,
           example_document_kind, example_document_stable_key, example_document_version, example_segment_index)
        select example_counts.word, example_counts.n, picked.example_title, picked.example_text,
               case when mv.id is null then 'article' else 'media' end,
               mi.stable_key, mv.version, picked.example_segment_index
        from example_counts
        join picked on picked.word = example_counts.word
        left join ${schema.mediaVersions} mv on mv.id = picked.example_version_id
        left join ${schema.mediaItems} mi on mi.id = mv.media_item_id
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
