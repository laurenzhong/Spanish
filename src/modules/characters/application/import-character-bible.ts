import { validateCharacterBible } from "../domain";
import type { CharacterBible } from "../schemas";
import type { CharacterRepository, PersistedCanonFact, PersistedCharacter } from "../repositories";

export class CharacterImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CharacterImportConflictError";
  }
}

export type CharacterImportResult = Readonly<{
  stableKey: string;
  version: number;
  characterId: string;
  status: "imported" | "unchanged";
}>;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function profileFor(character: CharacterBible): PersistedCharacter["profile"] {
  return {
    identity: character.identity,
    personality: character.personality,
    relationships: character.relationships,
    changeLog: character.changeLog,
    canonPolicies: Object.fromEntries(character.facts.filter((fact) => fact.isActive).map((fact) => [fact.factKey, {
      version: fact.version, category: fact.category, reveal: fact.reveal,
    }])),
  };
}

export function persistedFactsFor(character: CharacterBible): readonly PersistedCanonFact[] {
  return character.facts.map(({ factKey, value, sensitivity, version, isActive }) => ({
    factKey,
    value,
    sensitivity,
    version,
    isActive,
  }));
}

function sortedFacts(facts: readonly PersistedCanonFact[]): readonly PersistedCanonFact[] {
  return [...facts].sort((left, right) =>
    left.factKey.localeCompare(right.factKey) || left.version - right.version,
  );
}

function persistedPayload(existing: PersistedCharacter): Readonly<Record<string, unknown>> {
  return {
    stableKey: existing.stableKey,
    version: existing.version,
    displayName: existing.displayName,
    avatarUrl: existing.avatarUrl,
    homeLocation: existing.homeLocation,
    profile: existing.profile,
    facts: sortedFacts(existing.facts),
  };
}

function candidatePayload(character: CharacterBible, profile: PersistedCharacter["profile"]): Readonly<Record<string, unknown>> {
  return {
    stableKey: character.stableKey,
    version: character.version,
    displayName: character.displayName,
    avatarUrl: character.avatarUrl ?? null,
    homeLocation: character.homeLocation,
    profile,
    facts: sortedFacts(persistedFactsFor(character)),
  };
}

export function sameCharacterContent(existing: PersistedCharacter, character: CharacterBible): boolean {
  return canonical(persistedPayload(existing)) === canonical(candidatePayload(character, profileFor(character)));
}

function samePersistedCharacter(existing: PersistedCharacter, character: CharacterBible, profile: PersistedCharacter["profile"]): boolean {
  return canonical({
    ...persistedPayload(existing),
    status: existing.status,
  }) === canonical({
    ...candidatePayload(character, profile),
    status: character.status,
  });
}

export async function importCharacterBible(repository: CharacterRepository, input: unknown): Promise<CharacterImportResult> {
  const character = validateCharacterBible(input);
  const profile = profileFor(character);
  return repository.transaction(async (transaction) => {
    const existing = await transaction.findByStableVersion(character.stableKey, character.version);
    if (existing) {
      if (!samePersistedCharacter(existing, character, profile)) {
        throw new CharacterImportConflictError(`Character ${character.stableKey}@${character.version} already exists with different content.`);
      }
      return { stableKey: character.stableKey, version: character.version, characterId: existing.id, status: "unchanged" };
    }
    // Import deliberately does not create the character identity (ADR 0014 /
    // slice 3). A new revision arrives as a draft, and
    // `character_identities.current_character_id` is not nullable, so an
    // identity created here would have to point at that unpublished revision —
    // exactly the state the ADR forbids. `publish` creates the identity when it
    // publishes the key's first revision; until then read paths fail closed
    // because they resolve the character through the identity.
    const inserted = await transaction.insert({ character, profile });
    return { stableKey: character.stableKey, version: character.version, characterId: inserted.id, status: "imported" };
  });
}
