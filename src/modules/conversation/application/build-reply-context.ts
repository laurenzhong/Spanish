import type { MemoryRecord, MemoryRepository } from "@/src/modules/memory";
import { getConversationCharacter } from "../domain/character-catalog";
import { questionPolicyForReply, type QuestionPolicy } from "../domain/reply-plan";

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

export type ReplyOpenTopic = Readonly<{
  topicKey: string;
  label: string;
  status: "open" | "answered" | "closed";
  lastMentionedBy: "user" | "character";
  lastAnswer?: string;
}>;

export const defaultRecentMessageCharBudget = 8_000;

export type ReplyContext = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  recentMessages: readonly Readonly<{ role: "user" | "character"; content: string }>[];
  rollingSummary: string | null;
  openTopics: readonly ReplyOpenTopic[];
  character: ReplyCharacterSnapshot;
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  relationshipSummary: string | null;
  memories: readonly ReplyMemory[];
  teachingOpportunity: Readonly<{
    skillKey: string;
    preferredStyle?: "follow-up" | "recast" | "clarification";
  }> | null;
  questionPolicy?: QuestionPolicy;
}>;

export type BuildReplyContextInput = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  character?: ReplyCharacterSnapshot;
  relationshipStage?: ReplyContext["relationshipStage"];
  relationshipSummary?: string | null;
  recentMessages?: readonly Readonly<{ role: "user" | "character"; content: string }>[];
  rollingSummary?: string | null;
  openTopics?: readonly ReplyOpenTopic[];
  recentMessageCharBudget?: number;
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

function normalizedTopicText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function topicKeyForQuestion(value: string): string {
  const normalized = normalizedTopicText(value);
  if (/\b(?:comer|comida|almuerzo|mediodia|cena|desayuno)\b/iu.test(normalized)) return "daily:meal";
  if (/\b(?:hacer|haces|haciendo|dia|tarde|manana|noche)\b/iu.test(normalized)) return "daily:activity";
  if (/\b(?:estar|estas|estado|bien|tal)\b/iu.test(normalized)) return "wellbeing";
  return `question:${normalized.slice(0, 96)}`;
}

function topicLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 140);
}

/** Builds a small deterministic topic projection from completed message history. */
export function deriveReplyOpenTopics(
  messages: readonly Readonly<{ role: "user" | "character"; content: string }>[],
): readonly ReplyOpenTopic[] {
  const topics = new Map<string, ReplyOpenTopic>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role !== "user" || !message.content.includes("?")) continue;
    const label = topicLabel(message.content);
    if (!label) continue;
    const answer = messages[index + 1]?.role === "character" ? messages[index + 1]?.content.trim() : "";
    const topicKey = topicKeyForQuestion(label);
    topics.set(topicKey, {
      topicKey,
      label,
      status: answer ? "answered" : "open",
      lastMentionedBy: "user",
      ...(answer ? { lastAnswer: answer.slice(0, 240) } : {}),
    });
  }
  return [...topics.values()].slice(-12);
}

function budgetRecentMessages(
  messages: readonly Readonly<{ role: "user" | "character"; content: string }>[],
  budget: number,
): readonly Readonly<{ role: "user" | "character"; content: string }>[] {
  const normalized = messages
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0);
  if (normalized.length === 0) return [];
  const safeBudget = Number.isFinite(budget) && budget > 0 ? Math.floor(budget) : defaultRecentMessageCharBudget;
  const selected: typeof normalized = [];
  let used = 0;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const message = normalized[index];
    if (!message) continue;
    const cost = message.content.length + 16;
    if (selected.length > 0 && used + cost > safeBudget) break;
    selected.unshift(message);
    used += cost;
  }
  return selected;
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
    recentMessages: budgetRecentMessages(input.recentMessages ?? [], input.recentMessageCharBudget ?? defaultRecentMessageCharBudget),
    rollingSummary: input.rollingSummary?.trim() || null,
    openTopics: input.openTopics ?? deriveReplyOpenTopics(input.recentMessages ?? []),
    character,
    relationshipStage: input.relationshipStage ?? "new_contact",
    relationshipSummary: input.relationshipSummary ?? null,
    memories: readableMemories(memories, character.characterKey),
    teachingOpportunity: input.teachingOpportunity ?? null,
    questionPolicy: questionPolicyForReply({ userMessage: input.userMessage }),
  };
}
