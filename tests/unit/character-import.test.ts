import { describe, expect, it } from "vitest";

import luciaSource from "@/content/characters/lucia.json";
import mateoSource from "@/content/characters/mateo.json";
import inesSource from "@/content/characters/ines.json";
import {
  CharacterImportConflictError,
  CharacterPublishError,
  importCharacterBible,
  profileFor,
  publishCharacterBible,
  publishCharacterBibles,
  validateCharacterBible,
} from "@/src/modules/characters";
import type { CharacterRepository, PersistedCharacter } from "@/src/modules/characters";

type FakeState = {
  /** Persisted revisions, keyed `stableKey@version` — one `characters` row each. */
  revisions: Map<string, PersistedCharacter>;
  /** `character_identities`: stable key -> the revision its pointer names. */
  pointers: Map<string, string>;
  /** Sequence for the revision ids the fake hands out. */
  nextId: number;
};

function revisionKey(stableKey: string, version: number): string {
  return `${stableKey}@${version}`;
}

/**
 * Single-character in-memory `CharacterRepository` shaped like the Drizzle one:
 * revisions are separate rows, and `publish` is what maintains the identity
 * pointer. `seed` describes the row the fake starts with (the old single-row
 * fake passed one), while `state.revisions` lets a test hold several revisions
 * of the same key.
 */
function repository(
  existing: PersistedCharacter | null = null,
  state: FakeState = { revisions: new Map(), pointers: new Map(), nextId: 1 },
): CharacterRepository & { readonly state: FakeState } {
  if (existing) state.revisions.set(revisionKey(existing.stableKey, existing.version), existing);
  const toPersisted = (character: Parameters<CharacterRepository["insert"]>[0]["character"], id: string, profile: Parameters<CharacterRepository["insert"]>[0]["profile"]): PersistedCharacter => ({
    id,
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
  });
  return {
    state,
    async findByStableVersion(stableKey, version) {
      return state.revisions.get(revisionKey(stableKey, version)) ?? null;
    },
    async insert({ character, profile }) {
      const id = `character-${state.nextId++}`;
      const inserted = toPersisted(character, id, profile);
      state.revisions.set(revisionKey(character.stableKey, character.version), inserted);
      return inserted;
    },
    async replaceDraft({ character, profile }) {
      const key = revisionKey(character.stableKey, character.version);
      const current = state.revisions.get(key);
      if (!current) throw new Error("CHARACTER_UNAVAILABLE");
      const replaced = { ...toPersisted(character, current.id, profile), status: current.status };
      state.revisions.set(key, replaced);
      return replaced;
    },
    async publish({ stableKey, version }) {
      const key = revisionKey(stableKey, version);
      const current = state.revisions.get(key);
      if (!current) throw new Error("CHARACTER_UNAVAILABLE");
      if (current.status === "published") return current;
      const published = { ...current, status: "published" as const };
      state.revisions.set(key, published);
      // Mirrors the Drizzle repository: the pointer write is part of publish,
      // and only runs once the revision above really is published.
      state.pointers.set(stableKey, published.id);
      return published;
    },
    async transaction(work) { return work(this); },
  };
}

/** The revision each stable key currently points at (the identity pointer). */
function pointers(state: FakeState): Record<string, string> {
  return Object.fromEntries([...state.pointers.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function asVersion(source: unknown, version: number): Record<string, unknown> {
  return { ...(structuredClone(source) as Record<string, unknown>), version };
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
    expect(result.reviews.every((review) => review.reviewerReference.startsWith("dsh-ai-owner-authorized-review:"))).toBe(true);
    expect(result.reviews.every((review) => review.notes.includes("AI"))).toBe(true);

    const repeated = await publishCharacterBible({ repository: target, source: mateoSource });
    expect(repeated.status).toBe("unchanged");
  });

  it("persists the active fact's authored disclosure metadata rather than a later inactive fact policy", () => {
    const bible = validateCharacterBible(structuredClone(luciaSource));
    const active = bible.facts[1]!;
    bible.facts.push({ ...active, version: active.version + 1, isActive: false, reveal: { ...active.reveal, mode: "never" } });
    expect(profileFor(bible).canonPolicies?.[active.factKey]).toEqual({ version: active.version, category: active.category, reveal: active.reveal });
  });

  it("publishes a revision above version 1 only against the revision it supersedes", async () => {
    const target = repository();
    const previous = { ...validateCharacterBible(structuredClone(luciaSource)), version: luciaSource.version - 1, changeLog: [] };
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
    expect(result.character.version).toBe(luciaSource.version);
  });
});

describe("character identity pointer (ADR 0014, slice 3)", () => {
  it("moves the pointer to the revision that was just published", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    expect(pointers(target.state)).toEqual({});

    const published = await publishCharacterBible({ repository: target, source: mateoSource });

    expect(published.character.status).toBe("published");
    expect(pointers(target.state)).toEqual({ mateo: published.character.id });
  });

  it("creates the identity when the published character has none yet", async () => {
    const target = repository();
    await importCharacterBible(target, inesSource);
    expect(pointers(target.state)).toEqual({});

    const published = await publishCharacterBible({ repository: target, source: inesSource });

    expect(pointers(target.state)).toEqual({ ines: published.character.id });
    expect(published.character.id).toBe(
      (await target.findByStableVersion("ines", 1))?.id,
    );
  });

  it("leaves the pointer alone when the published key already had an identity", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const first = await publishCharacterBible({ repository: target, source: mateoSource });

    const repeated = await publishCharacterBible({ repository: target, source: mateoSource });

    expect(repeated.status).toBe("unchanged");
    expect(pointers(target.state)).toEqual({ mateo: first.character.id });
  });

  it("does not move the pointer when a draft is imported", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const published = await publishCharacterBible({ repository: target, source: mateoSource });

    // A newer revision arrives as a draft and must stay invisible until it is
    // published: if import moved the pointer it would point at unpublished
    // content, which the ADR forbids.
    const nextDraft = asVersion(mateoSource, 2);
    nextDraft.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    const imported = await importCharacterBible(target, nextDraft);

    expect(imported.status).toBe("imported");
    expect(imported.version).toBe(2);
    expect(pointers(target.state)).toEqual({ mateo: published.character.id });
  });

  it("moves the pointer to each character published by one multi-character transaction", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const publishedMateoV1 = await publishCharacterBible({ repository: target, source: mateoSource });
    await importCharacterBible(target, inesSource);
    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);

    const results = await publishCharacterBibles({
      repository: target,
      sources: [mateoV2, inesSource],
      currentRevisions: [{ ...validateCharacterBible(mateoSource), version: 1, changeLog: [] }, null],
    });

    const [mateo, ines] = results;
    expect(results.map((result) => result.status)).toEqual(["published", "published"]);
    expect(mateo!.character.version).toBe(2);
    expect(pointers(target.state)).toEqual({
      ines: ines!.character.id,
      mateo: mateo!.character.id,
    });
    expect(pointers(target.state).mateo).not.toBe(publishedMateoV1.character.id);
  });

  it("leaves the pointer untouched when the publish gate rejects the revision", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const published = await publishCharacterBible({ repository: target, source: mateoSource });

    // Version 2 without the revision it supersedes: refused by the gate before
    // any write, so the pointer stays on the published v1.
    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);
    await expect(publishCharacterBible({ repository: target, source: mateoV2 }))
      .rejects.toBeInstanceOf(CharacterPublishError);

    expect(pointers(target.state)).toEqual({ mateo: published.character.id });
  });

  it("leaves the pointer untouched when the published revision disappears mid-flight", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    const published = await publishCharacterBible({ repository: target, source: mateoSource });

    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);
    // The row the publish would flip is gone by the time it writes, which is how
    // the real repository reports CHARACTER_UNAVAILABLE.
    target.state.revisions.delete("mateo@2");

    await expect(publishCharacterBible({
      repository: target,
      source: mateoV2,
      current: { ...validateCharacterBible(mateoSource), version: 1, changeLog: [] },
    })).rejects.toMatchObject({ code: "CHARACTER_UNAVAILABLE" });

    expect(pointers(target.state)).toEqual({ mateo: published.character.id });
  });

  it("writes the pointer through publish inside the caller's transaction", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    await publishCharacterBible({ repository: target, source: mateoSource });
    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);

    // The pointer must not be a second call the use case makes after `publish`
    // (that could fail on its own, or run outside the transaction). Record what
    // the use case actually calls, and drive it through the transaction the way
    // `publishCharacterBible` does.
    const calls: string[] = [];
    const methods = ["findByStableVersion", "insert", "replaceDraft", "publish"] as const;
    const recorder: CharacterRepository = {
      ...Object.fromEntries(methods.map((name) => [
        name,
        async (...args: readonly unknown[]) => {
          calls.push(name);
          return (target[name] as (...methodArgs: readonly unknown[]) => Promise<unknown>)(...args);
        },
      ])) as unknown as Omit<CharacterRepository, "transaction">,
      transaction: (work) => target.transaction(() => work(recorder)),
    };

    const result = await publishCharacterBible({
      repository: recorder,
      source: mateoV2,
      current: { ...validateCharacterBible(mateoSource), version: 1, changeLog: [] },
    });

    expect(calls).toContain("publish");
    expect(pointers(target.state)).toEqual({ mateo: result.character.id });
    expect(target.state.revisions.get("mateo@2")?.status).toBe("published");
  });

  it("keeps a newer revision's pointer when a superseded revision is published again", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    await publishCharacterBible({ repository: target, source: mateoSource });
    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);
    const publishedV2 = await publishCharacterBible({
      repository: target,
      source: mateoV2,
      current: { ...validateCharacterBible(mateoSource), version: 1, changeLog: [] },
    });

    // Re-publishing the already published v1 is a no-op ("unchanged"), so it
    // cannot drag the pointer back off the current v2.
    const repeated = await publishCharacterBible({ repository: target, source: mateoSource });

    expect(repeated.status).toBe("unchanged");
    expect(pointers(target.state)).toEqual({ mateo: publishedV2.character.id });
  });

  it("keeps the identity pointer on the version content of the revision it names", async () => {
    const target = repository();
    await importCharacterBible(target, mateoSource);
    await publishCharacterBible({ repository: target, source: mateoSource });
    const mateoV2 = asVersion(mateoSource, 2);
    mateoV2.changeLog = [{ version: 2, supersedesVersion: 1, changeReason: "Añade una regla de estilo." }];
    await importCharacterBible(target, mateoV2);
    await publishCharacterBible({
      repository: target,
      source: mateoV2,
      current: { ...validateCharacterBible(mateoSource), version: 1, changeLog: [] },
    });

    // Version content stays on the revision row; only user state follows the
    // identity. The v1 revision remains readable by its own version.
    expect(target.state.revisions.get("mateo@1")?.status).toBe("published");
    expect(target.state.revisions.get("mateo@2")?.facts).toEqual(
      mateoSource.facts.map(({ factKey, value, sensitivity, version, isActive }) => ({ factKey, value, sensitivity, version, isActive })),
    );
    expect(profileFor(validateCharacterBible(mateoV2 as unknown))).toEqual(target.state.revisions.get("mateo@2")?.profile);
  });
});
