import { describe, expect, it } from "vitest";

import luciaSource from "@/content/characters/lucia.json";
import mateoSource from "@/content/characters/mateo.json";
import inesSource from "@/content/characters/ines.json";
import {
  CharacterImportConflictError,
  importCharacterBible,
  publishCharacterBible,
  validateCharacterBible,
} from "@/src/modules/characters";
import type { CharacterRepository, PersistedCharacter } from "@/src/modules/characters";

function repository(existing: PersistedCharacter | null = null): CharacterRepository {
  let value = existing;
  return {
    async findByStableVersion() { return value; },
    async insert({ character, profile }) {
      value = {
        id: "character-1",
        stableKey: character.stableKey,
        version: character.version,
        status: character.status,
        displayName: character.displayName,
        avatarUrl: character.avatarUrl ?? null,
        homeLocation: character.homeLocation,
        profile,
        facts: character.facts.map(({ factKey, value, sensitivity, version, isActive }) => ({
          factKey,
          value,
          sensitivity,
          version,
          isActive,
        })),
      };
      return value;
    },
    async replaceDraft({ character, profile }) {
      if (!value) throw new Error("CHARACTER_UNAVAILABLE");
      value = {
        ...value,
        displayName: character.displayName,
        avatarUrl: character.avatarUrl ?? null,
        homeLocation: character.homeLocation,
        profile,
        facts: character.facts.map(({ factKey, value: factValue, sensitivity, version, isActive }) => ({
          factKey,
          value: factValue,
          sensitivity,
          version,
          isActive,
        })),
      };
      return value;
    },
    async publish() {
      if (!value) throw new Error("CHARACTER_UNAVAILABLE");
      value = { ...value, status: "published" };
      return value;
    },
    async transaction(work) { return work(this); },
  };
}

describe("importCharacterBible", () => {
  it("imports the validated draft with canon facts", async () => {
    const result = await importCharacterBible(repository(), luciaSource);
    expect(result).toMatchObject({ stableKey: "lucia", version: luciaSource.version, status: "imported" });
  });

  it("is idempotent for the same character version", async () => {
    const target = repository();
    const first = await importCharacterBible(target, luciaSource);
    const second = await importCharacterBible(target, luciaSource);
    expect(first.characterId).toBe(second.characterId);
    expect(second.status).toBe("unchanged");
  });

  it("rejects a different payload for an existing version", async () => {
    const target = repository();
    await importCharacterBible(target, luciaSource);
    const changed = structuredClone(luciaSource) as typeof luciaSource;
    changed.displayName = "Lucía distinta";
    await expect(importCharacterBible(target, changed)).rejects.toBeInstanceOf(CharacterImportConflictError);
  });

  it("validates both alpha-030 introduction characters as independent drafts", async () => {
    const mateo = await importCharacterBible(repository(), mateoSource);
    const ines = await importCharacterBible(repository(), inesSource);
    expect(mateo).toMatchObject({ stableKey: "mateo", version: 1, status: "imported" });
    expect(ines).toMatchObject({ stableKey: "ines", version: 1, status: "imported" });
  });

  it("publishes a validated character with explicit temporary review records", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const result = await publishCharacterBible({
      repository: target,
      source: mateoSource,
      reviewedAt: new Date("2026-08-25T04:00:00.000Z"),
    });
    expect(result.status).toBe("published");
    expect(result.character.status).toBe("published");
    expect(result.reviews).toHaveLength(3);
    expect(result.reviews.every((review) => review.reviewerReference.startsWith("codex-ai-temporary-review:"))).toBe(true);

    const repeated = await publishCharacterBible({ repository: target, source: mateoSource });
    expect(repeated.status).toBe("unchanged");
  });

  it("publishes a revision above version 1 only against the revision it supersedes", async () => {
    const target = repository();
    const previous = { ...validateCharacterBible(structuredClone(luciaSource)), version: 1, changeLog: [] };
    // The fake repository holds a single row, so only the candidate is imported;
    // the gate takes the superseded revision as an explicit input.
    await importCharacterBible(target, luciaSource);

    // The revision gate compares the candidate with what it replaces, so a
    // version above 1 without that revision must be refused rather than
    // published unchecked.
    await expect(publishCharacterBible({ repository: target, source: luciaSource }))
      .rejects.toMatchObject({ code: "CHARACTER_REVIEW_INVALID" });

    const result = await publishCharacterBible({ repository: target, source: luciaSource, current: previous });
    expect(result.status).toBe("published");
    expect(result.character.version).toBe(2);
  });
});
