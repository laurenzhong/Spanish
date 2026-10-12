import type { CharacterBible, CharacterCanonFact } from "../schemas";

/** The subset of a canon fact represented by character_canon_facts. */
export type PersistedCanonFact = Readonly<{
  factKey: CharacterCanonFact["factKey"];
  value: CharacterCanonFact["value"];
  sensitivity: CharacterCanonFact["sensitivity"];
  version: CharacterCanonFact["version"];
  isActive: CharacterCanonFact["isActive"];
}>;

export type PersistedCharacter = Readonly<{
  id: string;
  stableKey: string;
  version: number;
  status: CharacterBible["status"];
  displayName: string;
  avatarUrl: string | null;
  homeLocation: string;
  profile: Readonly<{
    identity: CharacterBible["identity"];
    personality: CharacterBible["personality"];
    relationships: CharacterBible["relationships"];
    changeLog: CharacterBible["changeLog"];
  }>;
  facts: readonly PersistedCanonFact[];
}>;

export type CharacterPublicationReview = Readonly<{
  locale: string;
  reviewerReference: string;
  notes: string;
  reviewedAt: Date;
}>;

export type CharacterRepository = Readonly<{
  findByStableVersion(stableKey: string, version: number): Promise<PersistedCharacter | null>;
  insert(input: Readonly<{ character: CharacterBible; profile: PersistedCharacter["profile"] }>): Promise<PersistedCharacter>;
  replaceDraft(input: Readonly<{ character: CharacterBible; profile: PersistedCharacter["profile"] }>): Promise<PersistedCharacter>;
  /**
   * Makes one revision the published one and, in the same write, points the
   * character's identity (`character_identities.current_character_id`, created
   * when the key has none yet) at it — ADR 0014 / slice 3.
   *
   * The pointer is part of `publish` rather than a separate method the use case
   * calls next to it, so "published" and "current" cannot drift apart: a caller
   * that forgets the second call, or a failure between the two, would otherwise
   * leave either a published revision nobody serves or a pointer on an
   * unpublished one. `import` deliberately does not move the pointer; only this
   * method does, and only after the revision has actually flipped to
   * `published`.
   */
  publish(input: Readonly<{
    stableKey: string;
    version: number;
    reviews: readonly CharacterPublicationReview[];
  }>): Promise<PersistedCharacter>;
  transaction<T>(work: (repository: CharacterRepository) => Promise<T>): Promise<T>;
}>;
