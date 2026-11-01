/** Author-reviewed tendencies, never a source of canon or relationship authority. */
export type CharacterBehaviorProfile = Readonly<{
  schemaVersion: 1;
  characterKey: string;
  characterVersion: number;
  profileVersion: string;
  traits: readonly Readonly<{
    id: string;
    tendency: string;
    activationConditions: readonly string[];
    behaviorRange: readonly string[];
    stressVariation: string;
    mustNotInfer: readonly string[];
    sourceRefs: readonly string[];
  }>[];
}>;

/** Provider-safe projection excludes author-only provenance. */
export type CharacterBehaviorGuidance = Omit<CharacterBehaviorProfile, "traits"> & Readonly<{
  traits: readonly Omit<CharacterBehaviorProfile["traits"][number], "sourceRefs">[];
}>;
