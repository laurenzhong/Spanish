import { randomUUID } from "node:crypto";

import type { CharacterReplyProvider, ConversationProviderInput } from "@/src/modules/providers/conversation";
import type { MemoryRecord } from "@/src/modules/memory";
import { buildReplyContext, luciaConversationTimeZone, type ReplyCharacterSnapshot, type ReplyContext } from "./build-reply-context";
import {
  evaluateProactiveEligibility,
  isProactiveMessageSafe,
  proactiveDedupeKey,
  proactiveReplyPlan,
  repeatsAnsweredQuestion,
  type ProactiveDailyState,
  type ProactiveMessageSource,
  type ProactiveReplyPlan,
} from "../domain/proactive-message";
import type { ConversationMessageRecord } from "../repositories/conversation-repository";
import type { ProactiveMessageCandidateRecord, ProactiveMessageRepository } from "../repositories/proactive-message-repository";

export type GenerateProactiveMessageResult = Readonly<{
  status: "generated" | "suppressed" | "in-progress" | "failed";
  reason?: string;
  candidate: ProactiveMessageCandidateRecord | null;
  message: ConversationMessageRecord | null;
}>;

export type PreviewProactiveMessageResult = Readonly<{
  status: "preview" | "failed";
  reason?: string;
  text: string | null;
}>;

/**
 * An unsolicited message still has to remember the conversation that came
 * before it. Without this projection the character could only see memories and
 * would ask again about something the user had already answered.
 */
const proactiveContinuityInstruction = "Este mensaje es espontáneo y no responde a un mensaje nuevo. Usa recentMessages y memories como lo que ya sabes de la conversación: no preguntes por información que la persona ya te contó y no repitas una pregunta que ya te respondió. Si retomas un tema anterior, aporta un detalle nuevo y concreto; una frase sin pregunta también es suficiente.";

/** The single retry a proactive message gets when it repeats an answered question. */
const proactiveRepeatRetryInstruction = "Tu mensaje anterior repetía una pregunta que la persona ya respondió o pedía un dato que ya está en la conversación. Escribe un mensaje espontáneo nuevo que no vuelva a preguntar eso, sin repetir tus mensajes anteriores y sin convertir la charla en un cuestionario. Puedes compartir una observación breve sin pregunta.";

const proactiveContextMessageLimit = 100;

type ProactiveMemory = MemoryRecord;

type ProactiveGenerationScope = Readonly<{
  userId: string;
  source: ProactiveMessageSource;
  dailyState: ProactiveDailyState;
  now: Date;
  repository: ProactiveMessageRepository;
  provider: CharacterReplyProvider;
  character: ReplyCharacterSnapshot;
  memories: readonly ProactiveMemory[];
  generationId: string;
}>;

function completedContextMessages(
  history: readonly ConversationMessageRecord[],
): ReplyContext["recentMessages"] {
  return history
    .filter((message) => message.status === "completed" && message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content,
      sentAt: message.createdAt.toISOString(),
    }));
}

async function buildProactiveReplyContext(
  input: ProactiveGenerationScope,
  state: Readonly<{
    relationshipStage: ReplyContext["relationshipStage"];
    relationshipSummary: string | null;
  }>,
): Promise<ReplyContext> {
  const history = await input.repository.listRecentMessages(input.userId, proactiveContextMessageLimit);
  return buildReplyContext({
    generationId: input.generationId,
    userId: input.userId,
    userMessage: "",
    character: input.character,
    relationshipStage: state.relationshipStage,
    relationshipSummary: state.relationshipSummary,
    recentMessages: completedContextMessages(history),
    now: input.now,
    // Proactive messages are always Lucía's; the character timezone defines
    // what "today" means for the sentence the provider writes.
    conversationTimeZone: luciaConversationTimeZone,
    memories: input.memories,
  });
}

function proactiveProviderInput(
  context: ReplyContext,
  plan: ProactiveReplyPlan,
  input: ProactiveGenerationScope,
  continuityInstruction: string,
): ConversationProviderInput {
  return {
    inputKind: "proactive",
    userMessage: "",
    recentMessages: context.recentMessages,
    rollingSummary: context.rollingSummary,
    openTopics: context.openTopics,
    characterClaims: context.characterClaims,
    openCommitments: context.openCommitments,
    conversationTimeZone: context.conversationTimeZone,
    currentLocalDate: context.currentLocalDate,
    continuityInstruction,
    character: context.character,
    relationshipStage: context.relationshipStage,
    relationshipSummary: context.relationshipSummary,
    relationshipSignalsSummary: context.relationshipSummary,
    memories: context.memories,
    teachingOpportunity: null,
    questionPolicy: plan.questionPolicy,
    proactiveMessageSource: input.source,
    interactionMode: plan.interactionMode,
    affectionIntensityCeiling: plan.affectionIntensityCeiling,
    dailyState: input.dailyState,
    preferredLength: plan.preferredLength,
  };
}

/**
 * Generates one bounded proactive candidate. A message that repeats an
 * already-answered question gets one corrective retry; if the retry still
 * repeats it, the candidate fails instead of reaching the user.
 */
async function generateSafeProactiveText(
  input: ProactiveGenerationScope,
  context: ReplyContext,
  plan: ProactiveReplyPlan,
): Promise<Readonly<{ status: "generated"; text: string } | { status: "blocked" }>> {
  const first = await input.provider.generate(proactiveProviderInput(context, plan, input, proactiveContinuityInstruction));
  const firstText = first.text.trim();
  if (!isProactiveMessageSafe(firstText, plan)) return { status: "blocked" };
  if (!repeatsAnsweredQuestion(context.recentMessages, firstText)) return { status: "generated", text: firstText };

  const retry = await input.provider.generate(proactiveProviderInput(context, plan, input, proactiveRepeatRetryInstruction));
  const retryText = retry.text.trim();
  if (!isProactiveMessageSafe(retryText, plan) || repeatsAnsweredQuestion(context.recentMessages, retryText)) {
    return { status: "blocked" };
  }
  return { status: "generated", text: retryText };
}

/** Generates a candidate without touching cooldowns, candidates or messages. */
export async function previewLuciaProactiveMessage(input: Readonly<{
  userId: string;
  source: ProactiveMessageSource;
  dailyState?: ProactiveDailyState;
  now?: Date;
  repository: ProactiveMessageRepository;
  provider?: CharacterReplyProvider;
  /** Published server-resolved projection; tests explicitly inject their fixture. */
  character?: ReplyCharacterSnapshot;
  memories?: readonly ProactiveMemory[];
}>): Promise<PreviewProactiveMessageResult> {
  const now = input.now ?? new Date();
  const state = await input.repository.getEligibilityState(input.userId, now);
  if (state.relationshipStatus !== "active") return { status: "failed", reason: "relationship-inactive", text: null };
  if (!input.character || input.character.characterKey !== "lucia") return { status: "failed", reason: "character-runtime-unavailable", text: null };
  if (!input.provider) return { status: "failed", reason: "provider-unavailable", text: null };
  const dailyState = input.dailyState ?? "available";
  const plan = proactiveReplyPlan(input.source, state.relationshipStage, dailyState);
  const scope: ProactiveGenerationScope = {
    userId: input.userId,
    source: input.source,
    dailyState,
    now,
    repository: input.repository,
    provider: input.provider,
    character: input.character,
    memories: input.memories ?? [],
    generationId: `preview-${randomUUID()}`,
  };
  try {
    const context = await buildProactiveReplyContext(scope, state);
    const generated = await generateSafeProactiveText(scope, context, plan);
    if (generated.status === "blocked") return { status: "failed", reason: "safety-gate", text: null };
    return { status: "preview", text: generated.text };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "provider-unavailable", text: null };
  }
}

export async function generateLuciaProactiveMessage(input: Readonly<{
  userId: string;
  source: ProactiveMessageSource;
  sourceEventId?: string | null;
  dailyState?: ProactiveDailyState;
  now?: Date;
  repository: ProactiveMessageRepository;
  provider?: CharacterReplyProvider;
  /** Published server-resolved projection; tests explicitly inject their fixture. */
  character?: ReplyCharacterSnapshot;
  memories?: readonly ProactiveMemory[];
}>): Promise<GenerateProactiveMessageResult> {
  const now = input.now ?? new Date();
  const state = await input.repository.getEligibilityState(input.userId, now);
  const eligibility = evaluateProactiveEligibility(state, now);
  if (!eligibility.allowed) return { status: "suppressed", reason: eligibility.reason, candidate: null, message: null };
  if (!input.character || input.character.characterKey !== "lucia") return { status: "failed", reason: "character-runtime-unavailable", candidate: null, message: null };

  const conversationId = await input.repository.getConversationId(input.userId);
  const dedupeKey = proactiveDedupeKey({
    source: input.source,
    sourceEventId: input.sourceEventId,
    calendarDay: now.toISOString().slice(0, 10),
  });
  const generationId = randomUUID();
  const candidate = await input.repository.createCandidate({
    userId: input.userId,
    conversationId,
    sourceType: input.source,
    dedupeKey,
    generationId,
    notBefore: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1_000),
  });
  if (candidate.status === "generated") return { status: "generated", candidate, message: null };
  if (candidate.status === "failed") return { status: "failed", reason: candidate.lastErrorCode ?? "candidate-failed", candidate, message: null };
  if (candidate.status !== "generating" || candidate.generationId !== generationId) {
    return { status: "in-progress", reason: "candidate-in-progress", candidate, message: null };
  }

  const dailyState = input.dailyState ?? "available";
  const plan = proactiveReplyPlan(input.source, state.relationshipStage, dailyState);
  if (!input.provider) {
    await input.repository.failCandidate({ userId: input.userId, candidateId: candidate.id, errorCode: "provider-unavailable" });
    return { status: "failed", reason: "provider-unavailable", candidate, message: null };
  }
  try {
    const scope: ProactiveGenerationScope = {
      userId: input.userId,
      source: input.source,
      dailyState,
      now,
      repository: input.repository,
      provider: input.provider,
      character: input.character,
      memories: input.memories ?? [],
      generationId,
    };
    const context = await buildProactiveReplyContext(scope, state);
    const generated = await generateSafeProactiveText(scope, context, plan);
    if (generated.status === "blocked") {
      await input.repository.failCandidate({ userId: input.userId, candidateId: candidate.id, errorCode: "safety-gate" });
      return { status: "failed", reason: "safety-gate", candidate, message: null };
    }
    const completed = await input.repository.completeCandidate({
      userId: input.userId,
      candidateId: candidate.id,
      messageId: randomUUID(),
      generationId,
      content: generated.text,
    });
    return { status: "generated", candidate: completed.candidate, message: completed.message };
  } catch (error) {
    const errorCode = error instanceof Error && /^[A-Za-z0-9._-]{1,96}$/u.test(error.message)
      ? error.message
      : "provider-unavailable";
    await input.repository.failCandidate({ userId: input.userId, candidateId: candidate.id, errorCode });
    return { status: "failed", reason: errorCode, candidate, message: null };
  }
}
