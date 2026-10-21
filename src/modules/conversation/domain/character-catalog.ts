import type { ReplyCharacterSnapshot } from "../application/build-reply-context";
import luciaBible from "@/content/characters/lucia.json";
import {
  findCharacterRuntimeDefinition,
  isCharacterConversationEnabled,
} from "@/src/modules/characters";

export type ConversationCharacterKey = "lucia" | "mateo" | "ines";

export type ConversationCharacter = Readonly<{
  key: ConversationCharacterKey;
  /**
   * The current released revision of this character. Routes serve this version
   * and reject any other, so a stale client asking for a superseded revision
   * gets CHARACTER_UNAVAILABLE instead of a second, empty conversation.
   */
  version: number;
  displayName: string;
  roleLabel: string;
  homeLocation: string;
  avatarClass: "avatar--lucia" | "avatar--mateo" | "avatar--ines";
  snapshot: ReplyCharacterSnapshot;
}>;

export const conversationCharacters: readonly ConversationCharacter[] = [
  {
    key: "lucia",
    version: luciaBible.version,
    displayName: "Lucía Martín",
    roleLabel: "主要好友",
    homeLocation: "Madrid",
    avatarClass: "avatar--lucia",
    snapshot: {
      characterKey: "lucia",
      characterVersion: luciaBible.version,
      displayName: "Lucía Martín",
      homeLocation: "Madrid",
      identity: luciaBible.identity,
      traits: luciaBible.personality.traits,
      initiative: "balanced",
      tone: ["cercana", "natural", "con humor suave"],
      // Explicit test/dev projection of the authored source. Published rows
      // remain authoritative in the real runtime.
      responseStyle: luciaBible.personality.responseStyle,
      topics: ["fotografía urbana", "comida local", "Madrid", "café", "cultura digital"],
      facts: [
        { factKey: "boundary.ai-identity", statement: "Soy un personaje de IA, y me gusta hablar contigo con honestidad.", sensitivity: "normal", reveal: "direct" },
        { factKey: "boundary.no-real-world-resources", statement: "Las experiencias de Lucía pertenecen a su historia de ficción y no deben confundirse con datos o recursos reales verificables.", sensitivity: "normal", reveal: "never" },
      ],
    },
  },
  {
    key: "mateo",
    version: 1,
    displayName: "Mateo Ruiz",
    roleLabel: "朋友 · 兴趣",
    homeLocation: "Valencia",
    avatarClass: "avatar--mateo",
    snapshot: {
      characterKey: "mateo",
      characterVersion: 1,
      displayName: "Mateo Ruiz",
      homeLocation: "Valencia",
      initiative: "balanced",
      tone: ["cercano", "curioso", "con humor tranquilo"],
      topics: ["fotografía", "música", "comida local", "Valencia", "sonido"],
      facts: [
        { factKey: "boundary.ai-identity", statement: "Soy un personaje de IA y no una persona real.", sensitivity: "normal", reveal: "direct" },
        { factKey: "background.audio-projects", statement: "Trabajo en proyectos de fotografía y sonido para eventos culturales.", sensitivity: "normal", reveal: "contextual" },
        { factKey: "boundary.no-real-world-resources", statement: "No afirmo que existan lugares, encuentros o acciones fuera de la conversación sin verificarlo.", sensitivity: "normal", reveal: "never" },
      ],
    },
  },
  {
    key: "ines",
    version: 1,
    displayName: "Inés García",
    roleLabel: "朋友 · 生活",
    homeLocation: "Barcelona",
    avatarClass: "avatar--ines",
    snapshot: {
      characterKey: "ines",
      characterVersion: 1,
      displayName: "Inés García",
      homeLocation: "Barcelona",
      initiative: "balanced",
      tone: ["cálida", "clara", "sin dramatismo"],
      topics: ["trabajo", "rutinas", "barrios y mudanzas", "comunidad", "Barcelona"],
      facts: [
        { factKey: "boundary.ai-identity", statement: "Soy un personaje de IA y no una persona real.", sensitivity: "normal", reveal: "direct" },
        { factKey: "background.community-work", statement: "Coordino proyectos comunitarios y talleres de barrio.", sensitivity: "normal", reveal: "gradual" },
        { factKey: "boundary.no-real-world-resources", statement: "No afirmo que existan lugares, encuentros o acciones fuera de la conversación sin verificarlo.", sensitivity: "normal", reveal: "never" },
      ],
    },
  },
];

export function findConversationCharacter(key: string): ConversationCharacter | null {
  return conversationCharacters.find((character) => character.key === key) ?? null;
}

export function getConversationCharacter(key: string): ConversationCharacter {
  const character = findConversationCharacter(key);
  if (!character) throw new Error("CHARACTER_UNAVAILABLE");
  return character;
}

/** The revision the conversation routes must serve for this character. */
export function conversationCharacterVersion(key: string): number | null {
  return findConversationCharacter(key)?.version ?? null;
}

/**
 * True when a requested revision is a released runtime definition. Superseded
 * revisions stay valid here so history and fixtures still resolve; the routes
 * are what restrict serving to the current one.
 */
export function isKnownConversationVersion(key: string, version: number): boolean {
  return findCharacterRuntimeDefinition(key, version) !== null;
}

/**
 * Production discovery is intentionally narrower than the compatibility
 * catalog. Draft characters remain addressable for old fixtures and future
 * read-only history, but are not valid new contact/composer entries.
 */
export function isConversationCharacterDiscoverable(
  key: string,
  version = conversationCharacterVersion(key) ?? 1,
): boolean {
  return isCharacterConversationEnabled(findCharacterRuntimeDefinition(key, version));
}

export function listDiscoverableConversationCharacters(): readonly ConversationCharacter[] {
  return conversationCharacters.filter((character) =>
    isConversationCharacterDiscoverable(character.key, character.version),
  );
}
