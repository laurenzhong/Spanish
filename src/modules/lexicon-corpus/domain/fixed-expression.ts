/**
 * Fixed multi-word expressions, and what extraction may propose for them.
 *
 * ## The rule
 *
 * A fixed expression is **one lexical unit**. Two consequences, and they are the
 * whole of this file:
 *
 * 1. A member that has **no independent meaning** is not a lexeme candidate. If
 *    extraction proposes one from a segment where the expression occurs, the
 *    proposal is dropped — not reviewed, not stored, not rejected. Learning
 *    `repente` as a noun is learning a word that does not exist outside
 *    `de repente`.
 * 2. The expression itself is proposed, as a **phrase** candidate, whenever it
 *    occurs in a segment. That is where its meaning belongs, and it is the only
 *    path by which `phrase_entries` fills at all.
 *
 * ## Why the member list is narrow, and why that is the point
 *
 * `nonIndependentMembers` is not "every word of the expression". `fin` in
 * `por fin`, `embargo` in `sin embargo` and `supuesto` in `por supuesto` are
 * perfectly good lexemes in their own right — dropping those candidates would
 * trade one wrong candidate for a missing correct one. Only members with no
 * independent meaning qualify, which in practice means a handful of forms that
 * survive *only* inside their expression (`repente`, `seguida`, `vilo`, `veras`).
 *
 * An expression may therefore be listed with an empty `nonIndependentMembers`:
 * it is worth an entry as a phrase without invalidating any lexeme candidate.
 *
 * ## What this deliberately is not
 *
 * It is not a prompt instruction and not a reviewer hint. The reviewer's prose
 * is explanatory only and can never change a verdict
 * (see `lexicon-review-reason.ts`), so a rule that lived in the prompt would be
 * advice rather than a constraint. This is a deterministic function of the
 * segment text and a reviewed list, it runs before any paid call, and it is
 * tested directly.
 *
 * The list is data, not a heuristic: adding an expression is a reviewable edit
 * with a test, and the module never guesses that two adjacent words form a unit.
 */
import { findPhraseMatches, type PhraseMatch } from "./phrase";

export type FixedExpressionKind =
  | "locucion-adverbial"
  | "locucion-conjuntiva"
  | "locucion-prepositiva"
  | "locucion-verbal"
  | "marcador-discursivo";

export type FixedExpression = Readonly<{
  /** The expression as it is normally written. */
  surface: string;
  kind: FixedExpressionKind;
  /**
   * Members with no independent meaning. Empty for expressions whose members are
   * all learnable on their own; only these forms are dropped as candidates.
   */
  nonIndependentMembers: readonly string[];
}>;

/**
 * The reviewed list.
 *
 * Kept short on purpose. Every entry is a claim that the expression is a unit
 * worth learning, and every `nonIndependentMembers` entry is a stronger claim:
 * that the form does not stand alone in Spanish at all.
 */
export const FIXED_EXPRESSIONS: readonly FixedExpression[] = [
  // Members that do not exist outside their expression.
  { surface: "de repente", kind: "locucion-adverbial", nonIndependentMembers: ["repente"] },
  { surface: "en seguida", kind: "locucion-adverbial", nonIndependentMembers: ["seguida"] },
  { surface: "en vilo", kind: "locucion-adverbial", nonIndependentMembers: ["vilo"] },
  { surface: "de veras", kind: "locucion-adverbial", nonIndependentMembers: ["veras"] },
  // Units worth an entry whose members are learnable separately.
  { surface: "sin embargo", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "por supuesto", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "a lo mejor", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "por fin", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "tal vez", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "de pronto", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "a menudo", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "de nuevo", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "de hecho", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "en realidad", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "por ejemplo", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "sobre todo", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "más o menos", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "de todas formas", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "de todos modos", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "sin duda", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "en general", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "por cierto", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "a propósito", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "de golpe", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "de vez en cuando", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "poco a poco", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "al fin y al cabo", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "a la vez", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "en efecto", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "por desgracia", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "en absoluto", kind: "locucion-adverbial", nonIndependentMembers: [] },
  { surface: "o sea", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "es decir", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "en cambio", kind: "marcador-discursivo", nonIndependentMembers: [] },
  { surface: "a pesar de", kind: "locucion-prepositiva", nonIndependentMembers: [] },
];

/** One occurrence of a listed expression in a segment. */
export type FixedExpressionOccurrence = Readonly<{
  expression: FixedExpression;
  match: PhraseMatch;
}>;

/** Every listed expression that occurs in `segmentText`, in list order. */
export function findFixedExpressionsIn(segmentText: string): readonly FixedExpressionOccurrence[] {
  const found: FixedExpressionOccurrence[] = [];
  for (const expression of FIXED_EXPRESSIONS) {
    const [match] = findPhraseMatches(segmentText, expression.surface);
    if (match) found.push({ expression, match });
  }
  return found;
}

/** What extraction may do with one proposal, given the segment it came from. */
export type FixedExpressionProposalDecision =
  | Readonly<{ action: "keep" }>
  | Readonly<{ action: "keep-phrase"; occurrence: FixedExpressionOccurrence }>
  | Readonly<{ action: "drop-member"; occurrence: FixedExpressionOccurrence }>;

/**
 * Classify one proposal against the expression list.
 *
 * The member test fires only when the expression **occurs in this segment**: a
 * `repente` proposed from a segment that does not contain `de repente` is left
 * alone, because this function has no business judging a form it cannot see.
 */
export function classifyFixedExpressionProposal(input: Readonly<{
  kind: "lexeme" | "phrase";
  surfaceText: string;
  segmentText: string;
}>): FixedExpressionProposalDecision {
  const occurrences = findFixedExpressionsIn(input.segmentText);
  const surface = input.surfaceText.trim().toLocaleLowerCase("es");

  for (const occurrence of occurrences) {
    if (input.kind === "phrase" && occurrence.match.normalized === normalizeExpression(input.surfaceText)) {
      return { action: "keep-phrase", occurrence };
    }
    if (input.kind !== "lexeme") continue;
    const isMember = occurrence.expression.nonIndependentMembers
      .some((member) => member.toLocaleLowerCase("es") === surface);
    if (isMember) return { action: "drop-member", occurrence };
  }
  return { action: "keep" };
}

/** The expressions in `segmentText` that are worth proposing as phrase candidates. */
export function fixedExpressionPhraseProposals(segmentText: string): readonly FixedExpressionOccurrence[] {
  return findFixedExpressionsIn(segmentText);
}

function normalizeExpression(surface: string): string {
  return findPhraseMatches(surface, surface)[0]?.normalized ?? surface.trim().toLocaleLowerCase("es");
}
