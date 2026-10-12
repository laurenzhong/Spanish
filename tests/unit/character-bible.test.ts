import luciaSource from "@/content/characters/lucia.json";
import {
  canPublishCharacterRevision,
  checkCharacterRevision,
  CharacterCanonValidationError,
  validateCharacterBible,
  type CharacterBible,
} from "@/src/modules/characters";
import { describe, expect, it } from "vitest";

const lucia = validateCharacterBible(luciaSource);

function clone(value: CharacterBible): CharacterBible {
  return JSON.parse(JSON.stringify(value)) as CharacterBible;
}

function codes(result: ReturnType<typeof checkCharacterRevision>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe("Lucía character bible", () => {
  it("validates the current draft identity and honesty boundary", () => {
    expect(lucia.status).toBe("draft");
    expect(lucia.version).toBe(2);
    expect(lucia.identity).toMatchObject({
      age: 24,
      growthLocation: "Madrid",
    });
    expect(lucia.facts.find((fact) => fact.factKey === "boundary.ai-identity")?.reveal).toMatchObject({
      mode: "direct",
      audience: "any-user",
    });
  });

  it("rejects duplicate active facts", () => {
    const candidate = clone(lucia);
    candidate.facts.push({ ...candidate.facts[0]! });

    expect(() => validateCharacterBible(candidate)).toThrow(CharacterCanonValidationError);
    try {
      validateCharacterBible(candidate);
    } catch (error) {
      expect((error as CharacterCanonValidationError).issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["duplicate-fact-key", "duplicate-fact-version"]),
      );
    }
  });

  it("allows an unpublished, unrevealed draft identity edit in place", () => {
    const candidate = clone(lucia);
    candidate.identity.age = 25;

    expect(checkCharacterRevision(lucia, candidate, { allowDraftEdit: true })).toEqual({ ok: true });
  });

  it("requires a new version when a published identity changes", () => {
    const current = clone(lucia);
    current.status = "published";
    const candidate = clone(current);
    candidate.identity.age = 25;

    const result = checkCharacterRevision(current, candidate);
    expect(codes(result)).toEqual(expect.arrayContaining([
      "version-not-incremented",
      "identity-change-requires-version",
    ]));
  });

  it("accepts a versioned background fact addition", () => {
    const candidate = clone(lucia);
    candidate.version = 3;
    candidate.changeLog = [{
      version: 3,
      supersedesVersion: 2,
      changeReason: "Add a reviewed family background detail.",
    }];
    candidate.facts.push({
      factKey: "background.mother-origin",
      category: "background",
      value: { country: "Italy" },
      sensitivity: "normal",
      version: 3,
      isActive: true,
      reveal: {
        mode: "contextual",
        audience: "relationship",
        trigger: "Only when a trusted conversation naturally reaches family background.",
      },
    });

    expect(checkCharacterRevision(lucia, candidate)).toEqual({ ok: true });
  });

  it("blocks a versioned change to an already revealed identity fact", () => {
    const candidate = clone(lucia);
    candidate.version = 2;
    candidate.identity.age = 25;
    candidate.changeLog = [{
      version: 2,
      supersedesVersion: 1,
      changeReason: "Correct a canon identity detail after explicit review.",
    }];

    const result = checkCharacterRevision(lucia, candidate, {
      revealedFactKeys: ["identity.age"],
    });
    expect(codes(result)).toContain("revealed-fact-conflict");
  });

  it("blocks a silent expansion of sensitive fact disclosure", () => {
    const current = clone(lucia);
    current.facts.push({
      factKey: "background.private-health",
      category: "background",
      value: { note: "private" },
      sensitivity: "sensitive",
      version: 1,
      isActive: true,
      reveal: {
        mode: "never",
        audience: "relationship",
        trigger: "Never reveal automatically.",
      },
    });
    const candidate = clone(current);
    candidate.version = 2;
    candidate.changeLog = [{
      version: 2,
      supersedesVersion: 1,
      changeReason: "Adjust disclosure policy after review.",
    }];
    candidate.facts = candidate.facts.map((fact) =>
      fact.factKey === "background.private-health"
        ? { ...fact, version: 2, reveal: { ...fact.reveal, mode: "contextual" as const } }
        : fact,
    );

    const result = checkCharacterRevision(current, candidate);
    expect(codes(result)).toContain("sensitive-reveal-expansion");
  });

  it("does not pass a draft through the production publish gate", () => {
    const result = canPublishCharacterRevision(null, lucia, { approvedReview: true });
    expect(codes(result)).toContain("draft-not-publishable");
  });

  it("allows the initial version only after an approved review and publish status", () => {
    const candidate = { ...clone(lucia), version: 1, changeLog: [] };
    candidate.status = "published";

    expect(canPublishCharacterRevision(null, candidate, { approvedReview: true })).toEqual({ ok: true });
  });
});

