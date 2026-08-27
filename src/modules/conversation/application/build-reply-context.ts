import type { MemoryRecord, MemoryRepository } from "@/src/modules/memory";
import { getConversationCharacter } from "../domain/character-catalog";

export type ReplyCharacterSnapshot = Readonly<{
  characterKey: string;
  characterVersion: number;
  displayName: string;
  homeLocation: string;
  initiative: "low" | "balanced" | "high";
  tone: readonly string[];
  topics: readonly string[];
  facts: readonly Readonly<{
    factKey: string;
    statement: string;
    sensitivity: "normal" | "sensitive" | "private";
    reveal: "never" | "contextual" | "gradual" | "direct";
  }>[];
}>;

export const luciaReplyCharacter: ReplyCharacterSnapshot = getConversationCharacter("lucia").snapshot;

export type ReplyMemory = Readonly<Pick<MemoryRecord, "factKey" | "category" | "content" | "confidence" | "sensitivity" | "shareScope">>;

export type ReplyContext = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  recentMessages: readonly Readonly<{ role: "user" | "character"; content: string }>[];
  character: ReplyCharacterSnapshot;
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSummary: string | null;
  memories: readonly ReplyMemory[];
  teachingOpportunity: Readonly<{
    skillKey: string;
    preferredStyle?: "follow-up" | "recast" | "clarification";
  }> | null;
}>;

export type BuildReplyContextInput = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  character?: ReplyCharacterSnapshot;
  relationshipStage?: ReplyContext["relationshipStage"];
  relationshipSummary?: string | null;
  recentMessages?: readonly Readonly<{ role: "user" | "character"; content: string }>[];
  memories?: readonly MemoryRecord[];
  memoryRepository?: MemoryRepository;
  teachingOpportunity?: ReplyContext["teachingOpportunity"];
}>;

function readableMemories(memories: readonly MemoryRecord[], characterKey: string): readonly ReplyMemory[] {
  return memories
    .filter((memory) => memory.status !== "rejected" && memory.status !== "conflict")
    .filter((memory) => memory.characterKey === characterKey || memory.shareScope === "explicit")
    .filter((memory) => memory.content.trim().length > 0)
    .map(({ factKey, category, content, confidence, sensitivity, shareScope }) => ({
      factKey,
      category,
      content,
      confidence,
      sensitivity,
      shareScope,
    }));
}

/** Builds a privacy-filtered context. Memory access is always through the readable projection. */
export async function buildReplyContext(input: BuildReplyContextInput): Promise<ReplyContext> {
  const character = input.character ?? luciaReplyCharacter;
  const memories = input.memoryRepository
    ? await input.memoryRepository.listReadableMemories(input.userId, character.characterKey)
    : (input.memories ?? []);

  return {
    generationId: input.generationId,
    userId: input.userId,
    userMessage: input.userMessage.trim(),
    recentMessages: (input.recentMessages ?? []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    character,
    relationshipStage: input.relationshipStage ?? "new_contact",
    relationshipSummary: input.relationshipSummary ?? null,
    memories: readableMemories(memories, character.characterKey),
    teachingOpportunity: input.teachingOpportunity ?? null,
  };
}
