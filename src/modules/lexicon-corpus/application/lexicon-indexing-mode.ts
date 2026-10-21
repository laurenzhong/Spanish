/**
 * Lexicon indexing feature switch (LEX-INDEX-001 slice 6).
 *
 * ADR-0011 §7 requires the indexing pipeline to be **off unless explicitly
 * enabled**. This module is the single place that decides what a configured
 * value means, and it is deliberately fail-closed:
 *
 * - a missing value is `disabled`;
 * - an unrecognised value is `disabled` (not an error the caller can ignore,
 *   and never a value that happens to enable indexing);
 * - matching is exact after trimming and lower-casing, so `"review_only"`,
 *   `"true"`, `"yes"` and `"1"` are all `disabled`.
 *
 * The ladder is ordered, and each rung is a strict superset of the previous one:
 *
 * | mode          | extract | 双维度审核 | owner 批准 | 索引 corpus |
 * |---------------|---------|------------|------------|-------------|
 * | `disabled`    | no      | no         | no         | no          |
 * | `review-only` | yes     | yes        | no         | no          |
 * | `index`       | yes     | yes        | yes        | yes         |
 *
 * `review-only` is the "只推进到审核库" mode from ADR-0011: candidates reach the
 * review library and stop there. `index` still requires an owner-authorized
 * approval on the run input — this switch authorises the *capability*, never the
 * decision, so extraction can never approve itself.
 *
 * Reading the environment is a default argument only: importing this module has
 * no side effect, and no credential (`MINIMAX_API_KEY` or otherwise) is ever
 * read here.
 */

/** The configuration key. Named exactly as the ADR states it. */
export const LEXICON_INDEXING_MODE_ENV_KEY = "LEXICON_INDEXING_MODE" as const;

export const lexiconIndexingModeValues = ["disabled", "review-only", "index"] as const;
export type LexiconIndexingMode = (typeof lexiconIndexingModeValues)[number];

/** Off by default; every unknown or missing value resolves here. */
export const DEFAULT_LEXICON_INDEXING_MODE: LexiconIndexingMode = "disabled";

/** The minimal shape of an environment: anything that can be absent. */
export type LexiconIndexingEnvironment = Readonly<Record<string, string | undefined>>;

export function isLexiconIndexingMode(value: unknown): value is LexiconIndexingMode {
  return typeof value === "string" && (lexiconIndexingModeValues as readonly string[]).includes(value);
}

/**
 * Normalise one configured value. Anything that is not a known mode — including
 * a non-string, an empty string and a typo — becomes `disabled`.
 *
 * The pipeline re-runs this over its own input, so a caller that passes an
 * unvalidated string (a CLI flag, a request parameter, a JSON config field)
 * cannot widen the switch by accident.
 */
export function normalizeLexiconIndexingMode(value: unknown): LexiconIndexingMode {
  if (typeof value !== "string") return DEFAULT_LEXICON_INDEXING_MODE;
  const normalized = value.trim().toLowerCase();
  return isLexiconIndexingMode(normalized) ? normalized : DEFAULT_LEXICON_INDEXING_MODE;
}

/** Resolve the switch from an environment-like record (defaults to `process.env`). */
export function resolveLexiconIndexingMode(
  environment: LexiconIndexingEnvironment = process.env,
): LexiconIndexingMode {
  return normalizeLexiconIndexingMode(environment[LEXICON_INDEXING_MODE_ENV_KEY]);
}

/** Whether the mode lets the pipeline call the extraction provider at all. */
export function lexiconIndexingExtracts(mode: LexiconIndexingMode): boolean {
  return mode !== "disabled";
}

/**
 * Whether the mode lets the pipeline approve a reviewed candidate and write the
 * corpus. Only `index` does; `review-only` never reaches the corpus.
 */
export function lexiconIndexingIndexes(mode: LexiconIndexingMode): boolean {
  return mode === "index";
}

/** Whether the mode stops before review, so candidates stay out of the library. */
export function lexiconIndexingReviews(mode: LexiconIndexingMode): boolean {
  return mode !== "disabled";
}
