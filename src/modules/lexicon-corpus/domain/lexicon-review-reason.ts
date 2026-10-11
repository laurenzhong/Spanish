/**
 * The explanatory half of a review record: why the reviewer answered the way it
 * did.
 *
 * ## The one rule this file exists to enforce
 *
 * A reason is **purely explanatory**. It never participates in the verdict:
 * nothing here is read by the state machine, by the approval gate or by any
 * decision function. `outcome` is the only authority, and it is the *input*
 * `outcome` that is stored — not anything inferred from the prose.
 *
 * That separation is a security property, not tidiness. The reason text is
 * written by the same model that produced the verdict, so if any code path let
 * the prose influence the stored outcome, the model could talk its way to a
 * different verdict: a `fail` whose reason says "actually this is correct"
 * would become a pass, and the owner gate would be decorative. Keeping the two
 * apart means the worst a misleading reason can do is mislead a *human reader*,
 * who can see the verdict it was attached to.
 *
 * Concretely: `reason` is optional, free-form, capped and truncated, and every
 * function in this module is total — it cannot throw, cannot reject a review and
 * cannot change an outcome. Losing an explanation is acceptable; losing a
 * verdict is not.
 */

/**
 * Maximum stored length of a reason, in characters.
 *
 * The current vendor payload caps `reason` at 1200 characters, so this is a
 * ceiling for *other* reviewers and for future prompt changes rather than a
 * routine trim: the adapter never silently shortens a reason that fits. When a
 * longer one does arrive it is truncated rather than refused — an over-long
 * explanation must never fail a review.
 */
export const LEXICON_REVIEW_REASON_MAX_LENGTH = 1_500;

/**
 * The same ceiling applied to each individual evidence quote or issue.
 *
 * These are supporting detail, so they are capped tighter than the reason
 * itself; a reviewer that returns fifty issues costs the row a list, not a
 * verdict.
 */
export const LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH = 400;

/** How many evidence quotes and issues are worth keeping per review. */
export const LEXICON_REVIEW_REASON_MAX_ITEMS = 6;

/**
 * Normalise a reason into `string | null`. Total by construction.
 *
 * - a non-string (a number, an object, a model that answered with an array)
 *   becomes `null`: an unusable explanation is dropped, never an error;
 * - whitespace-only becomes `null`, so an empty explanation is simply absent;
 * - anything longer than the cap is truncated to exactly the cap, with no
 *   ellipsis appended — the stored value is a prefix of what the reviewer said,
 *   and adding marker characters would make the stored text not a prefix;
 * - the input is never mutated and nothing here consults `outcome`.
 */
export function normalizeReviewReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > LEXICON_REVIEW_REASON_MAX_LENGTH
    ? trimmed.slice(0, LEXICON_REVIEW_REASON_MAX_LENGTH)
    : trimmed;
}

/**
 * Normalise the reviewer's supporting quotes.
 *
 * Returns `null` — not `[]` — when nothing usable came back, so "the reviewer
 * said nothing" stays distinguishable from "the reviewer said nothing useful
 * and we stored an empty list". A non-array, or an array with no usable member,
 * collapses to `null`; a member is never allowed to fail the review.
 */
export function normalizeReviewEvidence(value: unknown): readonly string[] | null {
  return normalizeReviewItemList(value);
}

/** Normalise the reviewer's flagged issues. Same contract as `normalizeReviewEvidence`. */
export function normalizeReviewIssues(value: unknown): readonly string[] | null {
  return normalizeReviewItemList(value);
}

function normalizeReviewItemList(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const kept: string[] = [];
  for (const member of value) {
    if (typeof member !== "string") continue;
    const trimmed = member.trim();
    if (!trimmed) continue;
    kept.push(
      trimmed.length > LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH
        ? trimmed.slice(0, LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH)
        : trimmed,
    );
    if (kept.length >= LEXICON_REVIEW_REASON_MAX_ITEMS) break;
  }
  return kept.length > 0 ? kept : null;
}
