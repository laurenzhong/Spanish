// @vitest-environment node

import { describe, expect, it } from "vitest";

import coreBundle from "@/content/bundles/alpha-core-v2.json";
import scenarioBundle from "@/content/bundles/scenario-practice-alpha-v4.json";
import { validateContentBundle } from "@/src/modules/content/import";

const reviewerReference = "codex-ai-owner-authorized-review";

function approvedLocales(
  bundle: ReturnType<typeof validateContentBundle>,
  entityType: "expression" | "scenario",
  stableKey: string,
  version: number,
) {
  return bundle.reviews
    .filter(
      (review) =>
        review.entityType === entityType &&
        review.stableKey === stableKey &&
        review.version === version &&
        review.status === "approved" &&
        review.reviewerReference === reviewerReference,
    )
    .map((review) => review.locale)
    .toSorted();
}

describe("owner-authorized published content bundles", () => {
  it("publishes only the approved ALPHA-033 scope", () => {
    const core = validateContentBundle(coreBundle);
    const scenarios = validateContentBundle(scenarioBundle);

    expect(core.bundle).toMatchObject({ stableKey: "alpha.core", version: 2 });
    expect(scenarios.bundle).toMatchObject({
      stableKey: "alpha.scenario-practice",
      version: 4,
    });
    expect({
      domains: core.domains.length + scenarios.domains.length,
      goals: core.goals.length + scenarios.goals.length,
      expressions: core.expressions.length + scenarios.expressions.length,
      scenarios: scenarios.scenarios.length,
      packs: core.contentPacks.length + scenarios.contentPacks.length,
    }).toEqual({ domains: 9, goals: 29, expressions: 35, scenarios: 9, packs: 1 });

    expect(core.scenarios).toEqual([]);
    expect(core.articles).toEqual([]);
    expect(core.characters).toEqual([]);
    expect(scenarios.contentPacks).toEqual([]);
    expect(scenarios.articles).toEqual([]);
    expect(scenarios.characters).toEqual([]);

    for (const bundle of [core, scenarios]) {
      expect(bundle.domains.every((item) => item.status === "published")).toBe(true);
      expect(bundle.goals.every((item) => item.status === "published")).toBe(true);
      expect(bundle.expressions.every((item) => item.status === "published")).toBe(true);
      expect(bundle.expressions.every((item) =>
        item.variants.every((variant) => variant.status === "published"),
      )).toBe(true);
      for (const expression of bundle.expressions) {
        expect(
          approvedLocales(
            bundle,
            "expression",
            expression.stableKey,
            expression.version,
          ),
        ).toEqual(["es-ES", "zh-CN"]);
      }
      for (const scenario of bundle.scenarios) {
        expect(scenario.status).toBe("published");
        expect(
          approvedLocales(
            bundle,
            "scenario",
            scenario.stableKey,
            scenario.version,
          ),
        ).toEqual(["es-ES", "zh-CN"]);
      }
    }
  });

  it("keeps unchanged entities stable and versions every reviewed correction", () => {
    const core = validateContentBundle(coreBundle);
    const scenarios = validateContentBundle(scenarioBundle);
    const expressionVersions = new Map(
      [...core.expressions, ...scenarios.expressions].map((expression) => [
        expression.stableKey,
        expression.version,
      ]),
    );

    expect(Object.fromEntries(expressionVersions)).toMatchObject({
      "start.como-va-todo": 2,
      "relationship.como-se-llama": 1,
      "navigate.creo-que-estoy-perdido": 2,
      "restaurant.tomare-eso": 2,
      "campus.vengo-para": 2,
      "campus.puedo-enviarlo": 1,
      "rental.se-permiten": 2,
      "rental.otra-hora": 2,
    });
    expect(core.contentPacks[0]).toMatchObject({
      stableKey: "immersive.first-cafe-conversation",
      version: 1,
      status: "published",
    });
    expect(
      scenarios.scenarios.map((scenario) => [scenario.stableKey, scenario.version]),
    ).toEqual([
      ["scenario.restaurant-ordering", 2],
      ["scenario.campus-administration", 2],
      ["scenario.rental-conversation", 2],
      ["scenario.restaurant-takeaway", 1],
      ["scenario.campus-student-card", 1],
      ["scenario.rental-viewing", 1],
      ["scenario.transport-ticket", 1],
      ["scenario.post-office", 1],
      ["scenario.hotel-checkin", 1],
    ]);
  });

  it("locks the corrected language and fictional scenario boundaries", () => {
    const core = validateContentBundle(coreBundle);
    const scenarios = validateContentBundle(scenarioBundle);
    const expressions = new Map(
      [...core.expressions, ...scenarios.expressions].map((expression) => [
        expression.stableKey,
        expression,
      ]),
    );

    expect(expressions.get("navigate.creo-que-estoy-perdido")?.text).toBe(
      "Creo que me he perdido.",
    );
    expect(expressions.get("restaurant.tomare-eso")?.text).toBe(
      "Pues tomaré eso.",
    );
    expect(expressions.get("campus.vengo-para")?.text).toBe(
      "Vengo para formalizar mi matrícula.",
    );
    expect(expressions.get("rental.otra-hora")?.text).toBe(
      "¿Podríamos ver el piso a otra hora?",
    );
    expect(
      scenarios.scenarios.every(
        (scenario) => scenario.practice?.fictionalContext === true,
      ),
    ).toBe(true);
    expect(
      scenarios.scenarios.find(
        (scenario) => scenario.stableKey === "scenario.rental-conversation",
      )?.description["zh-CN"],
    ).toContain("完全虚构");
  });
});
