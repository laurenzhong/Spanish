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

export type ReplyContextMessage = Readonly<{
  role: "user" | "character";
  content: string;
  sentAt?: string;
}>;

export type ReplyOpenTopic = Readonly<{
  topicKey: string;
  label: string;
  status: "open" | "answered" | "closed";
  lastMentionedBy: "user" | "character";
  lastAnswer?: string;
  lastAskedAt?: string;
  lastAnsweredAt?: string;
  sameLocalDay?: boolean;
}>;

export const defaultRecentMessageCharBudget = 8_000;
export const luciaConversationTimeZone = "Europe/Madrid";

export type ReplyContext = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  recentMessages: readonly ReplyContextMessage[];
  rollingSummary: string | null;
  openTopics: readonly ReplyOpenTopic[];
  conversationTimeZone: string;
  currentLocalDate: string;
  continuityInstruction?: string | null;
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
  recentMessages?: readonly ReplyContextMessage[];
  rollingSummary?: string | null;
  openTopics?: readonly ReplyOpenTopic[];
  recentMessageCharBudget?: number;
  now?: Date;
  conversationTimeZone?: string;
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

function localDateFor(value: string | Date, timeZone: string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Builds a small deterministic topic projection from completed message history. */
export function deriveReplyOpenTopics(
  messages: readonly ReplyContextMessage[],
  options: Readonly<{ now?: Date; timeZone?: string }> = {},
): readonly ReplyOpenTopic[] {
  const timeZone = options.timeZone ?? luciaConversationTimeZone;
  const currentLocalDate = localDateFor(options.now ?? new Date(), timeZone);
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
      ...(message.sentAt ? { lastAskedAt: message.sentAt } : {}),
      ...(answer && messages[index + 1]?.sentAt ? { lastAnsweredAt: messages[index + 1]?.sentAt } : {}),
      ...(message.sentAt && currentLocalDate
        ? { sameLocalDay: localDateFor(message.sentAt, timeZone) === currentLocalDate }
        : {}),
    });
  }
  return [...topics.values()].slice(-12);
}

function budgetRecentMessages(
  messages: readonly ReplyContextMessage[],
  budget: number,
): readonly Readonly<{ role: "user" | "character"; content: string }>[] {
  const normalized = messages
    .map((message) => ({ role: message.role, content: message.content.trim(), sentAt: message.sentAt }))
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
  const now = input.now ?? new Date();
  const conversationTimeZone = input.conversationTimeZone ?? luciaConversationTimeZone;
  const currentLocalDate = localDateFor(now, conversationTimeZone) ?? now.toISOString().slice(0, 10);
  const memories = input.memoryRepository
    ? await input.memoryRepository.listReadableMemories(input.userId, character.characterKey)
    : (input.memories ?? []);

  return {
    generationId: input.generationId,
    userId: input.userId,
    userMessage: input.userMessage.trim(),
    recentMessages: budgetRecentMessages(input.recentMessages ?? [], input.recentMessageCharBudget ?? defaultRecentMessageCharBudget),
    rollingSummary: input.rollingSummary?.trim() || null,
    openTopics: input.openTopics ?? deriveReplyOpenTopics(input.recentMessages ?? [], { now, timeZone: conversationTimeZone }),
    conversationTimeZone,
    currentLocalDate,
    character,
    relationshipStage: input.relationshipStage ?? "new_contact",
    relationshipSummary: input.relationshipSummary ?? null,
    memories: readableMemories(memories, character.characterKey),
    teachingOpportunity: input.teachingOpportunity ?? null,
    questionPolicy: questionPolicyForReply({ userMessage: input.userMessage }),
  };
}
