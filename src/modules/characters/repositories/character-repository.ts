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
  publish(input: Readonly<{
    stableKey: string;
    version: number;
    reviews: readonly CharacterPublicationReview[];
  }>): Promise<PersistedCharacter>;
  transaction<T>(work: (repository: CharacterRepository) => Promise<T>): Promise<T>;
}>;
