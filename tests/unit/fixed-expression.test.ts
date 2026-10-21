import { describe, expect, it } from "vitest";

import {
  FIXED_EXPRESSIONS,
  classifyFixedExpressionProposal,
  findFixedExpressionsIn,
  fixedExpressionPhraseProposals,
} from "@/src/modules/lexicon-corpus/domain/fixed-expression";
import { normalizePhrase, tokenizeSpanish } from "@/src/modules/lexicon-corpus/domain";

/**
 * The fixed-expression rule.
 *
 * The rule exists because `repente` was reviewed as a NOUN candidate and settled
 * as `rejected`: the member of an adverbial phrase is not a noun lexeme, and no
 * amount of reviewer prose changes the fact that the candidate should never have
 * been proposed. So the member never becomes a candidate, and the expression
 * becomes a phrase candidate instead — both decided here, before any paid call.
 */

describe("fixed expressions", () => {
  it("drops a member that has no independent meaning", () => {
    const decision = classifyFixedExpressionProposal({
      kind: "lexeme",
      surfaceText: "repente",
      segmentText: "De repente, un grupo de droides aparece al final del pasillo.",
    });
    expect(decision.action).toBe("drop-member");
    if (decision.action !== "drop-member") return;
    expect(decision.occurrence.expression.surface).toBe("de repente");
    // The match is the expression's own occurrence — that is what makes the
    // member non-independent here.
    expect(decision.occurrence.match.surface).toBe("De repente");
    expect(decision.occurrence.match.normalized).toBe("de repente");
  });

  it("leaves the same form alone when its expression is not in the segment", () => {
    // The rule judges only what it can see; without the expression in the text
    // there is nothing that makes this member non-independent *here*.
    const decision = classifyFixedExpressionProposal({
      kind: "lexeme",
      surfaceText: "repente",
      segmentText: "El repente de la puerta asustó a todos.",
    });
    expect(decision.action).toBe("keep");
  });

  it("keeps the expression itself as a phrase proposal", () => {
    const decision = classifyFixedExpressionProposal({
      kind: "phrase",
      surfaceText: "de repente",
      segmentText: "De repente, todo cambió.",
    });
    expect(decision.action).toBe("keep-phrase");
  });

  it("does not drop members that are learnable on their own", () => {
    // `fin` in `por fin` is a perfectly good lexeme; dropping it would trade a
    // wrong candidate for a missing correct one.
    const decision = classifyFixedExpressionProposal({
      kind: "lexeme",
      surfaceText: "fin",
      segmentText: "Por fin llegó el día.",
    });
    expect(decision.action).toBe("keep");
  });

  it("finds expressions through case, accents and punctuation", () => {
    const occurrences = findFixedExpressionsIn("Sin embargo, DE PRONTO, ¡en seguida! y de vez en cuando.");
    const surfaces = occurrences.map((occurrence) => occurrence.expression.surface);
    expect(surfaces).toContain("sin embargo");
    expect(surfaces).toContain("de pronto");
    expect(surfaces).toContain("en seguida");
    expect(surfaces).toContain("de vez en cuando");
  });

  it("matches the longest expression, not a shorter lookalike", () => {
    const occurrences = findFixedExpressionsIn("Al fin y al cabo, da igual.");
    const matched = occurrences.map((occurrence) => occurrence.match.surface);
    expect(matched).toEqual(["Al fin y al cabo"]);
  });

  it("reports no occurrence when the expression is absent", () => {
    expect(findFixedExpressionsIn("Repente no es una palabra suelta.")).toHaveLength(0);
  });

  it("proposes each occurring expression once", () => {
    const proposals = fixedExpressionPhraseProposals("De repente, de repente y de repente.");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.expression.surface).toBe("de repente");
  });

  it("keeps the list itself well formed", () => {
    const seen = new Set<string>();
    for (const expression of FIXED_EXPRESSIONS) {
      const normalized = normalizePhrase(expression.surface);
      // A one-token "expression" is a lexeme, not a phrase, and would propose a
      // phrase candidate for a single word.
      expect(tokenizeSpanish(expression.surface).length, `${expression.surface} is multi-word`).toBeGreaterThan(1);
      expect(seen.has(normalized), `${expression.surface} is listed once`).toBe(false);
      seen.add(normalized);
      for (const member of expression.nonIndependentMembers) {
        // A member must be one token and must actually belong to the expression:
        // otherwise the drop rule would fire on a form the expression does not own.
        expect(tokenizeSpanish(member), `${member} is one token`).toHaveLength(1);
        expect(
          tokenizeSpanish(expression.surface).some((token) => token.normalized === normalizePhrase(member)),
          `${member} belongs to ${expression.surface}`,
        ).toBe(true);
      }
    }
  });

  it("drops every member the list claims is non-independent", () => {
    // Whatever the list says, the rule must act on it — this is the test that
    // fails if someone adds a member without the rule reaching it.
    for (const expression of FIXED_EXPRESSIONS) {
      for (const member of expression.nonIndependentMembers) {
        const decision = classifyFixedExpressionProposal({
          kind: "lexeme",
          surfaceText: member,
          segmentText: `Aquí va ${expression.surface} en una frase normal.`,
        });
        expect(decision.action, `${member} in ${expression.surface}`).toBe("drop-member");
      }
    }
  });
});
