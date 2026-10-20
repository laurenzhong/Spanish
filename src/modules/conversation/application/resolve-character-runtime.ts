import type {
  CharacterRepository,
  PersistedCharacter,
} from "@/src/modules/characters";
import {
  findCharacterRuntimeDefinition,
  isCharacterConversationEnabled,
  isPublishedCharacterStatus,
  type CharacterRuntimeDefinition,
} from "@/src/modules/characters";
import {
  findConversationCharacter,
  type ConversationCharacter,
} from "../domain/character-catalog";
import type { ReplyCharacterSnapshot } from "./build-reply-context";
import { characterBibleSchema } from "@/src/modules/characters/schemas";

export class CharacterRuntimeError extends Error {
  constructor(
    readonly code: "CHARACTER_UNAVAILABLE" | "CHARACTER_RUNTIME_UNAVAILABLE",
    message = code,
  ) {
    super(message);
    this.name = "CharacterRuntimeError";
  }
}

export type ResolvedConversationCharacter = Readonly<{
  catalog: ConversationCharacter;
  definition: CharacterRuntimeDefinition;
  persisted: PersistedCharacter | null;
}>;

function persistedSnapshot(
  persisted: PersistedCharacter,
  fallback: ConversationCharacter,
): ReplyCharacterSnapshot {
  const personality = (persisted.profile?.personality ?? {}) as Partial<{
    traits: readonly string[];
    initiative: ReplyCharacterSnapshot["initiative"];
    tone: readonly string[];
    responseStyle: readonly string[];
    topicPreferences: readonly Readonly<{ topic: string }>[];
  }>;
  const initiative = personality.initiative && ["low", "balanced", "high"].includes(personality.initiative)
    ? personality.initiative
    : fallback.snapshot.initiative;
  const topics = (personality.topicPreferences ?? []).map((item) => item.topic).filter(Boolean);
  const identity = characterBibleSchema.shape.identity.safeParse(persisted.profile?.identity);
  const traits = characterBibleSchema.shape.personality.shape.traits.safeParse(personality.traits);
  const facts = persisted.facts
    .filter((fact) => fact.isActive)
    .map((fact) => {
      const value = fact.value as Record<string, unknown>;
      const statement = typeof value.statement === "string"
        ? value.statement
        : typeof value.rule === "string"
          ? value.rule
          : JSON.stringify(value);
      // New revisions keep their authored disclosure metadata in the same
      // versioned profile. A policy for another fact version cannot authorize
      // this one; older rows without a policy still fail closed.
      const storedPolicy = persisted.profile?.canonPolicies?.[fact.factKey];
      const policy = storedPolicy?.version === fact.version
        ? characterBibleSchema.shape.facts.element.shape.reveal.safeParse(storedPolicy.reveal)
        : null;
      const reveal = fact.factKey === "boundary.ai-identity"
        ? "direct"
        : policy?.success ? policy.data.mode : "never";
      return {
        factKey: fact.factKey,
        statement,
        sensitivity: fact.sensitivity,
        reveal: reveal as "never" | "contextual" | "gradual" | "direct",
        ...(policy?.success ? { audience: policy.data.audience, trigger: policy.data.trigger } : {}),
        ...(typeof value.topic === "string" ? { topic: value.topic } : {}),
      };
    });
  // The persisted character version is authoritative. An empty (or fully
  // inactive) fact set must not resurrect biography from the compatibility
  // catalog; doing so would make an old static snapshot part of a published
  // character's provider context. Keep only the invariant AI-identity
  // boundary when the older row has not stored any canon facts yet.
  const safeFacts = facts.length > 0
    ? facts
    : fallback.snapshot.facts.filter((fact) => fact.factKey === "boundary.ai-identity");
  return {
    characterKey: persisted.stableKey,
    characterVersion: persisted.version,
    displayName: persisted.displayName,
    homeLocation: persisted.homeLocation,
    ...(identity.success ? { identity: identity.data } : {}),
    ...(traits.success ? { traits: traits.data } : {}),
    initiative,
    tone: personality.tone?.length ? personality.tone : fallback.snapshot.tone,
    // The expression rules are what keeps a voice recognisable across replies.
    // A row imported before the bible carried them falls back to the catalog
    // the same way tone and topics already do.
    responseStyle: personality.responseStyle?.length
      ? personality.responseStyle
      : fallback.snapshot.responseStyle,
    topics: topics.length > 0 ? topics : fallback.snapshot.topics,
    facts: safeFacts,
  };
}

/**
 * Resolves a character for a production conversation request.
 *
 * A repository is authoritative whenever one is supplied. The static
 * projection is only usable by explicit test/development injection, so a
 * missing database cannot silently turn into a fake production character.
 */
export async function resolveConversationCharacter(input: Readonly<{
  characterKey: string;
  characterVersion: number;
  repository?: CharacterRepository;
  allowStaticFallback?: boolean;
  requiredCapability?: "conversation" | "proactiveMessages" | "introductions";
}>): Promise<ResolvedConversationCharacter> {
  const catalog = findConversationCharacter(input.characterKey);
  const definition = findCharacterRuntimeDefinition(input.characterKey, input.characterVersion);
  if (!catalog || !definition || !isCharacterConversationEnabled(definition)) {
    throw new CharacterRuntimeError("CHARACTER_UNAVAILABLE");
  }
  if (input.requiredCapability === "proactiveMessages" && !definition.policy.proactiveMessages) {
    throw new CharacterRuntimeError("CHARACTER_UNAVAILABLE");
  }
  if (input.requiredCapability === "introductions" && !definition.policy.introductions) {
    throw new CharacterRuntimeError("CHARACTER_UNAVAILABLE");
  }

  if (!input.repository) {
    // The boolean is an explicit seam for deterministic tests/E2E, but it is
    // not an authorization switch on its own.  Keep the environment check at
    // this boundary so a caller cannot accidentally enable a fake character
    // runtime in production by passing `allowStaticFallback: true`.
    if (!input.allowStaticFallback || !isConversationStaticFallbackAllowed()) {
      throw new CharacterRuntimeError("CHARACTER_RUNTIME_UNAVAILABLE");
    }
    return { catalog, definition, persisted: null };
  }

  let persisted: PersistedCharacter | null;
  try {
    persisted = await input.repository.findByStableVersion(input.characterKey, input.characterVersion);
  } catch {
    throw new CharacterRuntimeError("CHARACTER_RUNTIME_UNAVAILABLE");
  }
  // Repositories are expected to scope this lookup by stable key/version, but
  // keep the invariant at the application boundary too. A stale or buggy
  // adapter must never let one character's canon become another character's
  // provider context.
  if (
    !persisted
    || persisted.stableKey !== input.characterKey
    || persisted.version !== input.characterVersion
    || !isPublishedCharacterStatus(persisted.status)
  ) {
    throw new CharacterRuntimeError("CHARACTER_UNAVAILABLE");
  }
  const resolvedCatalog: ConversationCharacter = {
    ...catalog,
    displayName: persisted.displayName,
    homeLocation: persisted.homeLocation,
    snapshot: persistedSnapshot(persisted, catalog),
  };
  return { catalog: resolvedCatalog, definition, persisted };
}

export function isConversationStaticFallbackAllowed(
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): boolean {
  // Vitest and Playwright inject deterministic fixtures. Local development
  // must opt in as well; production never may.
  if (environment.NODE_ENV === "production") return false;
  return environment.NODE_ENV === "test"
    || environment.AUTH_E2E_ENABLED === "1"
    || environment.CONVERSATION_ALLOW_FAKE === "1";
}
