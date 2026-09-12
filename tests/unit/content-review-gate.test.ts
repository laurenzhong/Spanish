// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { validateContentBundle } from "@/src/modules/content/import";

type BundleFixture = Record<string, unknown> & {
  domains: Array<Record<string, unknown>>;
  goals: Array<Record<string, unknown>>;
  expressions: Array<Record<string, unknown> & {
    variants: Array<Record<string, unknown>>;
  }>;
  scenarios: Array<Record<string, unknown> & {
    tasks: Array<Record<string, unknown>>;
  }>;
  reviews: Array<Record<string, unknown>>;
};

function readFixture(): BundleFixture {
  return JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "contracts",
        "fixtures",
        "content",
        "v1",
        "content-bundle-valid.json",
      ),
      "utf8",
    ),
  ) as BundleFixture;
}

function addApprovedReview(
  fixture: BundleFixture,
  entityType: "expression" | "scenario",
  locale: "es-ES" | "zh-CN",
) {
  if (
    fixture.reviews.some(
      (review) =>
        review.entityType === entityType &&
        review.locale === locale &&
        review.status === "approved",
    )
  ) {
    return;
  }
  const source = fixture.reviews.find(
    (review) => review.entityType === entityType,
  )!;
  fixture.reviews.push({
    ...source,
    locale,
    reviewerReference: "codex-ai-owner-authorized-review",
  });
}

function addDualReviews(fixture: BundleFixture) {
  for (const entityType of ["expression", "scenario"] as const) {
    addApprovedReview(fixture, entityType, "zh-CN");
  }
}

describe("published content review gate", () => {
  it("rejects a published expression without both language and teaching reviews", () => {
    const fixture = readFixture();
    fixture.scenarios[0]!.status = "draft";
    fixture.reviews = fixture.reviews.filter(
      (review) =>
        review.entityType !== "expression" || review.locale !== "zh-CN",
    );

    expect(() => validateContentBundle(fixture)).toThrow(
      /Published expression requires approved es-ES and zh-CN reviews/u,
    );
  });

  it("rejects a published scenario without both language and teaching reviews", () => {
    const fixture = readFixture();
    fixture.reviews = fixture.reviews.filter(
      (review) =>
        review.entityType !== "scenario" || review.locale !== "zh-CN",
    );

    expect(() => validateContentBundle(fixture)).toThrow(
      /Published scenario requires approved es-ES and zh-CN reviews/u,
    );
  });

  it("accepts published expressions and scenarios with both review dimensions", () => {
    const fixture = readFixture();
    addDualReviews(fixture);

    expect(validateContentBundle(fixture)).toMatchObject({
      schemaVersion: "1.0",
    });
  });

  it("rejects draft variants under a published expression", () => {
    const fixture = readFixture();
    addDualReviews(fixture);
    fixture.expressions[0]!.variants[0]!.status = "draft";

    expect(() => validateContentBundle(fixture)).toThrow(
      /Published expressions require published variants/u,
    );
  });

  it("rejects a published expression whose goal is not published", () => {
    const fixture = readFixture();
    addDualReviews(fixture);
    fixture.scenarios[0]!.status = "draft";
    fixture.goals[0]!.status = "draft";

    expect(() => validateContentBundle(fixture)).toThrow(
      /Published expressions require a published learning goal/u,
    );
  });

  it("rejects a published scenario that references draft content", () => {
    const fixture = readFixture();
    addDualReviews(fixture);
    fixture.expressions[0]!.status = "draft";

    expect(() => validateContentBundle(fixture)).toThrow(
      /Published scenarios require published goals and target expressions/u,
    );
  });
});
