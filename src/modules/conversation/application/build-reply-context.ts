import type { MemoryRecord, MemoryRepository } from "@/src/modules/memory";
import { getConversationCharacter } from "../domain/character-catalog";
import { hasGreetedOnLocalDate } from "../domain/greeting";
import { localDateInTimeZone } from "../domain/local-date";
import { questionPolicyForReply, type QuestionPolicy } from "../domain/reply-plan";

export type ReplyCharacterSnapshot = Readonly<{
  characterKey: string;
  characterVersion: number;
  displayName: string;
  homeLocation: string;
  /** Authored public identity; its presence does not mean the user was told it. */
  identity?: Readonly<{ age: number; growthLocation: string; education: string; occupation: string }>;
  traits?: readonly string[];
  initiative: "low" | "balanced" | "high";
  tone: readonly string[];
  /**
   * Expression rules from the character bible's `personality.responseStyle`:
   * how this character phrases things, not topics to bring up. Optional because
   * a character row imported before the field existed has none.
   */
  responseStyle?: readonly string[];
  topics: readonly string[];
  facts: readonly Readonly<{
    factKey: string;
    statement: string;
    sensitivity: "normal" | "sensitive" | "private";
    reveal: "never" | "contextual" | "gradual" | "direct";
    audience?: "any-user" | "relationship";
    trigger?: string;
    topic?: string;
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

export type ReplyCharacterClaim = Readonly<{
  claimKey: string;
  claimKind: "daily_observation" | "short_plan" | "current_state";
  statement: string;
  assertedAt?: string;
  sameLocalDay?: boolean;
  repeatableOnLaterDays: boolean;
}>;

export type ReplyCommitment = Readonly<{
  commitmentKey: string;
  owner: "user" | "character";
  statement: string;
  dueHint: "later-today" | "tomorrow" | "unspecified";
  /** Lifecycle state; `unconfirmed` means its due window passed without a clear outcome. */
  status: "open" | "returned" | "completed" | "cancelled" | "deferred" | "unconfirmed";
  madeAt?: string;
}>;

export const defaultRecentMessageCharBudget = 8_000;
export const luciaConversationTimeZone = "Europe/Madrid";

export type ReplyContext = Readonly<{
  generationId: string;
  userId: string;
  userMessage: string;
  /** Validated, still-unanswered submissions in order, including the latest. */
  unansweredUserMessages?: readonly string[];
  recentMessages: readonly ReplyContextMessage[];
  rollingSummary: string | null;
  openTopics: readonly ReplyOpenTopic[];
  characterClaims: readonly ReplyCharacterClaim[];
  openCommitments: readonly ReplyCommitment[];
  conversationTimeZone: string;
  currentLocalDate: string;
  /**
   * Whether the character already greeted the user on `currentLocalDate`.
   * Derived from the unbudgeted recent history so a long day cannot push the
   * earlier greeting out of the provider's recent-message budget.
   */
  alreadyGreetedToday?: boolean;
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
  unansweredUserMessages?: readonly string[];
  character?: ReplyCharacterSnapshot;
  relationshipStage?: ReplyContext["relationshipStage"];
  relationshipSummary?: string | null;
  recentMessages?: readonly ReplyContextMessage[];
  rollingSummary?: string | null;
  openTopics?: readonly ReplyOpenTopic[];
  characterClaims?: readonly ReplyCharacterClaim[];
  openCommitments?: readonly ReplyCommitment[];
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

function characterClaimKey(value: string): string | null {
  const normalized = normalizedTopicText(value);
  if (/\b(?:voy a|tengo pensado|pienso|esta tarde|esta noche)\b/iu.test(normalized) || (normalized.includes("manana") && !normalized.includes("esta manana"))) return "daily:plan";
  if (/\b(?:comer|comida|almuerzo|mediodia|cena|desayuno|arroz|patatas|tortilla|ensalada|pasta|sopa)\b/iu.test(normalized)) return "daily:meal";
  if (/\b(?:cafe|te|desayunar|beber|tomar)\b/iu.test(normalized)) return "daily:drink";
  if (/\b(?:dormir|despertar|despierta|cansada|cansado|acostar)\b/iu.test(normalized)) return "daily:energy";
  return null;
}

function characterClaimKind(claimKey: string): ReplyCharacterClaim["claimKind"] {
  if (claimKey === "daily:plan") return "short_plan";
  if (claimKey === "daily:energy") return "current_state";
  return "daily_observation";
}

function topicLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 140);
}

/** Builds a small deterministic topic projection from completed message history. */
export function deriveReplyOpenTopics(
  messages: readonly ReplyContextMessage[],
  options: Readonly<{ now?: Date; timeZone?: string }> = {},
): readonly ReplyOpenTopic[] {
  const timeZone = options.timeZone ?? luciaConversationTimeZone;
  const currentLocalDate = localDateInTimeZone(options.now ?? new Date(), timeZone);
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
        ? { sameLocalDay: localDateInTimeZone(message.sentAt, timeZone) === currentLocalDate }
        : {}),
    });
  }
  return [...topics.values()].slice(-12);
}

/** Extracts short-lived facts Lucía has stated about her own current day. */
export function deriveReplyCharacterClaims(
  messages: readonly ReplyContextMessage[],
  options: Readonly<{ now?: Date; timeZone?: string }> = {},
): readonly ReplyCharacterClaim[] {
  const timeZone = options.timeZone ?? luciaConversationTimeZone;
  const currentLocalDate = localDateInTimeZone(options.now ?? new Date(), timeZone);
  const claims = new Map<string, ReplyCharacterClaim>();
  for (const message of messages) {
    if (message.role !== "character" || !message.content.trim()) continue;
    const claimKey = characterClaimKey(message.content);
    if (!claimKey) continue;
    claims.set(claimKey, {
      claimKey,
      claimKind: characterClaimKind(claimKey),
      statement: message.content.trim().slice(0, 280),
      ...(message.sentAt ? { assertedAt: message.sentAt } : {}),
      ...(message.sentAt && currentLocalDate
        ? { sameLocalDay: localDateInTimeZone(message.sentAt, timeZone) === currentLocalDate }
        : {}),
      repeatableOnLaterDays: claimKey === "daily:meal" || claimKey === "daily:drink",
    });
  }
  return [...claims.values()].slice(-8);
}

function commitmentDueHint(value: string): ReplyCommitment["dueHint"] {
  const normalized = normalizedTopicText(value);
  if (normalized.includes("manana")) return "tomorrow";
  if (/(?:luego|despues|esta tarde|esta noche|cuando vuelva)/u.test(normalized)) return "later-today";
  return "unspecified";
}

const returnSignalPattern = /\b(?:ya\s+(?:he\s+)?vuelto|ya\s+volvi|he\s+vuelto|estoy\s+de\s+vuelta)\b/iu;
const completionSignalPattern = /\b(?:ya\s+(?:lo\s+)?he\s+hecho|ya\s+termine|he\s+terminado|ya\s+esta\s+hecho|ya\s+estan\s+hechas?|ya\s+hice|he\s+podido\s+hacerlo)\b/iu;
const cancellationSignalPattern = /\b(?:al\s+final\s+no\s+(?:fui|pude|lo\s+hice)|no\s+pude\s+(?:ir|hacerlo)|no\s+fui|lo\s+cancele|se\s+cancelo|lo\s+he\s+cancelado)\b/iu;
const deferralSignalPattern = /\b(?:lo\s+dejo\s+para\s+manana|lo\s+pospongo|otro\s+dia|al\s+final\s+ire\s+manana|se\s+me\s+ha\s+hecho\s+tarde)\b/iu;

function lifecycleSignal(value: string): ReplyCommitment["status"] | null {
  const normalized = normalizedTopicText(value);
  if (cancellationSignalPattern.test(normalized)) return "cancelled";
  if (deferralSignalPattern.test(normalized)) return "deferred";
  if (completionSignalPattern.test(normalized)) return "completed";
  if (returnSignalPattern.test(normalized)) return "returned";
  return null;
}

function markLatestOpenUserPlan(
  commitments: Map<string, ReplyCommitment>,
  userPlanKeys: readonly string[],
  status: Exclude<ReplyCommitment["status"], "open" | "unconfirmed">,
): void {
  for (let index = userPlanKeys.length - 1; index >= 0; index -= 1) {
    const planKey = userPlanKeys[index];
    const plan = planKey ? commitments.get(planKey) : undefined;
    if (plan?.status === "open") {
      commitments.set(planKey, { ...plan, status });
      return;
    }
  }
}

function dueWindowElapsed(commitment: ReplyCommitment, now: Date, timeZone: string): boolean {
  if (commitment.status !== "open" || !commitment.madeAt) return false;
  const madeAt = new Date(commitment.madeAt);
  if (Number.isNaN(madeAt.getTime())) return false;
  const nowMs = now.getTime();
  if (nowMs <= madeAt.getTime()) return false;
  const madeDate = localDateInTimeZone(madeAt, timeZone);
  const currentDate = localDateInTimeZone(now, timeZone);
  if (!madeDate || !currentDate) return false;
  const elapsedHours = (nowMs - madeAt.getTime()) / 3_600_000;
  if (commitment.dueHint === "later-today") return currentDate !== madeDate || elapsedHours >= 12;
  if (commitment.dueHint === "tomorrow") return currentDate > madeDate || elapsedHours >= 36;
  return elapsedHours >= 24;
}

function markUnconfirmedCommitments(
  commitments: readonly ReplyCommitment[],
  now: Date,
  timeZone: string,
): readonly ReplyCommitment[] {
  return commitments.map((commitment) => dueWindowElapsed(commitment, now, timeZone)
    ? { ...commitment, status: "unconfirmed" }
    : commitment);
}

/** Extracts explicit, low-pressure promises that can be followed up later. */
export function deriveReplyCommitments(
  messages: readonly ReplyContextMessage[],
  options: Readonly<{ now?: Date; timeZone?: string }> = {},
): readonly ReplyCommitment[] {
  const commitments = new Map<string, ReplyCommitment>();
  const userPlanKeys: string[] = [];
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message) continue;
    const normalized = normalizedTopicText(message.content);
    if (message.role === "user") {
      const status = lifecycleSignal(normalized);
      if (status) markLatestOpenUserPlan(commitments, userPlanKeys, status as Exclude<ReplyCommitment["status"], "open" | "unconfirmed">);
    }
    const explicitCommitment = /(?:te cuento|te digo|te escribo|te aviso|te mando|te paso)/u.test(normalized)
      && /(?:luego|despues|esta tarde|esta noche|manana|cuando vuelva|cuando termine|mas tarde)/u.test(normalized);
    const ordinaryUserPlan = message.role === "user"
      && /(?:voy a|me voy a|salgo a|salgo para|ire a|pienso ir|esta tarde voy|esta noche voy)/u.test(normalized);
    if (!explicitCommitment && !ordinaryUserPlan) continue;
    const owner = message.role === "user" ? "user" : "character";
    const commitmentKey = `${owner}:${ordinaryUserPlan ? "plan" : "promise"}:${normalized.slice(0, 96)}:${message.sentAt ?? messageIndex}`;
    commitments.set(commitmentKey, {
      commitmentKey,
      owner,
      statement: message.content.trim().slice(0, 240),
      dueHint: commitmentDueHint(message.content),
      status: "open",
      ...(message.sentAt ? { madeAt: message.sentAt } : {}),
    });
    if (ordinaryUserPlan) userPlanKeys.push(commitmentKey);
  }
  const now = options.now ?? new Date();
  const timeZone = options.timeZone ?? luciaConversationTimeZone;
  const current = [...commitments.values()].slice(-8);
  return options.now === undefined ? current : markUnconfirmedCommitments(current, now, timeZone);
}

/** Advances the most recent pending user plan when the current message reports a return/completion. */
export function advanceReplyCommitments(
  commitments: readonly ReplyCommitment[],
  currentUserMessage: string,
): readonly ReplyCommitment[] {
  const status = lifecycleSignal(currentUserMessage);
  if (!status || status === "open" || status === "unconfirmed") return commitments;
  let targetIndex = -1;
  for (let index = commitments.length - 1; index >= 0; index -= 1) {
    const commitment = commitments[index];
    if (!commitment || commitment.owner !== "user" || commitment.status !== "open" || !commitment.commitmentKey.includes(":plan:")) continue;
    if (/\b(?:voy|salgo|ire|pienso\s+ir|me\s+voy|hago|hacer|visitar|visito|examen|fotos?|puerto|evento|reunion)\b/iu.test(normalizedTopicText(commitment.statement))) {
      targetIndex = index;
      break;
    }
  }
  if (targetIndex < 0) return commitments;
  return commitments.map((commitment, index) => index === targetIndex ? { ...commitment, status } : commitment);
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
  const hasExplicitClock = input.now !== undefined;
  const conversationTimeZone = input.conversationTimeZone ?? luciaConversationTimeZone;
  const currentLocalDate = localDateInTimeZone(now, conversationTimeZone) ?? now.toISOString().slice(0, 10);
  const alreadyGreetedToday = hasGreetedOnLocalDate(input.recentMessages ?? [], currentLocalDate, conversationTimeZone);
  const memories = input.memoryRepository
    ? await input.memoryRepository.listReadableMemories(input.userId, character.characterKey)
    : (input.memories ?? []);
  const unansweredUserMessages = input.unansweredUserMessages?.map((message) => message.trim()).filter(Boolean);
  const unansweredText = unansweredUserMessages?.length ? unansweredUserMessages.join("\n\n") : input.userMessage;

  return {
    generationId: input.generationId,
    userId: input.userId,
    userMessage: input.userMessage.trim(),
    ...(unansweredUserMessages?.length ? { unansweredUserMessages } : {}),
    recentMessages: budgetRecentMessages(input.recentMessages ?? [], input.recentMessageCharBudget ?? defaultRecentMessageCharBudget),
    rollingSummary: input.rollingSummary?.trim() || null,
    openTopics: input.openTopics ?? deriveReplyOpenTopics(input.recentMessages ?? [], { now, timeZone: conversationTimeZone }),
    characterClaims: input.characterClaims ?? deriveReplyCharacterClaims(input.recentMessages ?? [], { now, timeZone: conversationTimeZone }),
    openCommitments: hasExplicitClock
      ? markUnconfirmedCommitments(
          advanceReplyCommitments(
            input.openCommitments ?? deriveReplyCommitments(input.recentMessages ?? [], { now, timeZone: conversationTimeZone }),
            input.userMessage,
          ),
          now,
          conversationTimeZone,
        )
      : advanceReplyCommitments(
          input.openCommitments ?? deriveReplyCommitments(input.recentMessages ?? []),
          input.userMessage,
        ),
    conversationTimeZone,
    currentLocalDate,
    alreadyGreetedToday,
    ...(unansweredUserMessages && unansweredUserMessages.length > 1 ? {
      continuityInstruction: "Han llegado varios mensajes antes de terminar tu respuesta. Responde al conjunto de unansweredUserMessages y a lo que ya dijiste, no solo a userMessage. Busca primero la conexión entre sus temas: si el último introduce un objeto que podría relacionarse con el interés anterior, formula esa conexión como una posibilidad concreta, sin darla por hecha, en vez de una pregunta genérica sobre el objeto. Un prefijo visible que solo reconoce un interés compartido no cierra ese tema: úsalo para conectar la nueva información sin volver a expresarlo. Si son temas independientes, conserva una breve respuesta útil a ambos. Omite preguntas ya respondidas, corregidas o cerradas; no repitas el prefijo visible. Usa mensajes breves separados por una línea en blanco cuando resulte natural.",
    } : {}),
    character,
    relationshipStage: input.relationshipStage ?? "new_contact",
    relationshipSummary: input.relationshipSummary ?? null,
    memories: readableMemories(memories, character.characterKey),
    teachingOpportunity: input.teachingOpportunity ?? null,
    questionPolicy: questionPolicyForReply({ userMessage: unansweredText }),
  };
}
