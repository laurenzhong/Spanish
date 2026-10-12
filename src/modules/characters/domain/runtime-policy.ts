import type { CharacterStatus } from "../schemas";

/**
 * Runtime capability is deliberately separate from the character lifecycle.
 * A prompt snapshot is not a production character, and publishing a character
 * must never implicitly enable every capability.
 */
export type CharacterConversationCapability = "disabled" | "basic" | "full";

export type CharacterRuntimePolicy = Readonly<{
  conversation: CharacterConversationCapability;
  proactiveMessages: boolean;
  romanticSubtext: boolean;
  introductions: boolean;
  persistentMemory: "none" | "private";
  maxRelationshipStage:
    | "new_contact"
    | "getting_to_know_you"
    | "familiar"
    | "close_friend";
  voiceInput: boolean;
}>;

export type CharacterRuntimeDefinition = Readonly<{
  stableKey: string;
  version: number;
  /** Intended release state of the checked-in runtime manifest. */
  lifecycle: "draft" | "published" | "retired";
  policy: CharacterRuntimePolicy;
}>;

/**
 * This is a capability manifest, not a second source of character facts.
 * Display name, canon and release status come from the versioned characters
 * table whenever a real runtime is used. The manifest only answers which
 * capabilities a published version is allowed to expose.
 */
export const characterRuntimeDefinitions: readonly CharacterRuntimeDefinition[] = [
  {
    stableKey: "lucia",
    version: 1,
    lifecycle: "published",
    policy: {
      conversation: "full",
      proactiveMessages: true,
      romanticSubtext: false,
      introductions: true,
      persistentMemory: "private",
      maxRelationshipStage: "close_friend",
      voiceInput: false,
    },
  },
  {
    // Current revision (2026-10-12): adds the expression rules to
    // personality.responseStyle. v1 stays published as immutable history so
    // older rows and fixtures still resolve; the conversation routes only serve
    // the catalog's current version, so this is what production uses.
    stableKey: "lucia",
    version: 2,
    lifecycle: "published",
    policy: {
      conversation: "full",
      proactiveMessages: true,
      romanticSubtext: false,
      introductions: true,
      persistentMemory: "private",
      maxRelationshipStage: "close_friend",
      voiceInput: false,
    },
  },
  {
    stableKey: "mateo",
    version: 1,
    lifecycle: "draft",
    policy: {
      conversation: "basic",
      proactiveMessages: false,
      romanticSubtext: false,
      introductions: false,
      persistentMemory: "private",
      maxRelationshipStage: "close_friend",
      voiceInput: false,
    },
  },
  {
    stableKey: "ines",
    version: 1,
    lifecycle: "draft",
    policy: {
      conversation: "basic",
      proactiveMessages: false,
      romanticSubtext: false,
      introductions: false,
      persistentMemory: "private",
      maxRelationshipStage: "close_friend",
      voiceInput: false,
    },
  },
];

export function findCharacterRuntimeDefinition(stableKey: string, version = 1): CharacterRuntimeDefinition | null {
  return characterRuntimeDefinitions.find((definition) =>
    definition.stableKey === stableKey && definition.version === version,
  ) ?? null;
}

export function isPublishedCharacterStatus(status: CharacterStatus | string): boolean {
  return status === "published";
}

export function isCharacterConversationEnabled(
  definition: CharacterRuntimeDefinition | null,
): boolean {
  return Boolean(
    definition
    && definition.lifecycle === "published"
    && definition.policy.conversation !== "disabled",
  );
}
