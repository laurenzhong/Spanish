import { describe, expect, it } from "vitest";

import {
  LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH,
  LEXICON_REVIEW_REASON_MAX_ITEMS,
  LEXICON_REVIEW_REASON_MAX_LENGTH,
  normalizeReviewEvidence,
  normalizeReviewIssues,
  normalizeReviewReason,
} from "@/src/modules/lexicon-corpus/domain/lexicon-review-reason";

/**
 * The reason contract: total, capped, and incapable of failing a review.
 *
 * Every case here is a shape a real model can produce — a number where a string
 * belongs, an array instead of text, a novel-length answer. None of them may
 * throw, because the caller is on the path that records a verdict and an
 * exception there would cost the verdict to save the explanation.
 */

describe("normalizeReviewReason", () => {
  it("keeps a usable reason verbatim", () => {
    expect(normalizeReviewReason("The form is used as a noun in the context.")).toBe(
      "The form is used as a noun in the context.",
    );
  });

  it("trims surrounding whitespace and treats blank text as absent", () => {
    expect(normalizeReviewReason("  spaced  ")).toBe("spaced");
    expect(normalizeReviewReason("   ")).toBeNull();
    expect(normalizeReviewReason("")).toBeNull();
    expect(normalizeReviewReason("\n\t ")).toBeNull();
  });

  it("returns null for every non-string shape instead of throwing", () => {
    for (const value of [null, undefined, 42, 0, true, false, {}, [], ["a"], () => "x", Symbol("s")]) {
      expect(() => normalizeReviewReason(value)).not.toThrow();
      expect(normalizeReviewReason(value)).toBeNull();
    }
  });

  it("truncates an over-long reason to exactly the cap, keeping it a prefix", () => {
    const reason = "x".repeat(LEXICON_REVIEW_REASON_MAX_LENGTH + 5_000);
    const normalized = normalizeReviewReason(reason);

    expect(normalized).not.toBeNull();
    expect(normalized).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
    // A prefix, with no marker appended: callers can compare it byte for byte.
    expect(reason.startsWith(normalized!)).toBe(true);
  });

  it("keeps a reason exactly at the cap untouched", () => {
    const reason = "y".repeat(LEXICON_REVIEW_REASON_MAX_LENGTH);
    expect(normalizeReviewReason(reason)).toHaveLength(LEXICON_REVIEW_REASON_MAX_LENGTH);
  });

  it("counts characters rather than bytes, so multi-byte prose survives", () => {
    // 1000 CJK characters are 3000 bytes; a byte cap would silently cut a third.
    const reason = "地震".repeat(500);
    expect(normalizeReviewReason(reason)).toHaveLength(1_000);
  });

  it("does not mutate its input", () => {
    const original = "  keep me  ";
    normalizeReviewReason(original);
    expect(original).toBe("  keep me  ");
  });
});

describe("normalizeReviewEvidence and normalizeReviewIssues", () => {
  it("keep usable strings and drop unusable members", () => {
    expect(normalizeReviewEvidence(["un terremoto", "", "   ", 7, null, "de magnitud 7.2"])).toEqual([
      "un terremoto",
      "de magnitud 7.2",
    ]);
    expect(normalizeReviewIssues(["missing meaningZh"])).toEqual(["missing meaningZh"]);
  });

  it("distinguishes 'said nothing' from 'said nothing usable'", () => {
    // Both collapse to null on purpose: an empty list is what the adapter writes
    // as `[]` in the packed reason, so the stored record stays honest about
    // whether anything was offered.
    expect(normalizeReviewEvidence([])).toBeNull();
    expect(normalizeReviewEvidence(["", "  "])).toBeNull();
    expect(normalizeReviewEvidence(null)).toBeNull();
    expect(normalizeReviewEvidence("not an array")).toBeNull();
    expect(normalizeReviewEvidence({ 0: "a" })).toBeNull();
    expect(normalizeReviewIssues(undefined)).toBeNull();
  });

  it("caps each member and the number of members", () => {
    const long = "z".repeat(LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH + 100);
    const many = Array.from({ length: LEXICON_REVIEW_REASON_MAX_ITEMS + 4 }, (_, index) => `item-${index}`);

    const capped = normalizeReviewEvidence([long]);
    expect(capped).toHaveLength(1);
    expect(capped![0]).toHaveLength(LEXICON_REVIEW_REASON_ITEM_MAX_LENGTH);

    expect(normalizeReviewIssues(many)).toHaveLength(LEXICON_REVIEW_REASON_MAX_ITEMS);
    expect(normalizeReviewIssues(many)![0]).toBe("item-0");
  });
});
