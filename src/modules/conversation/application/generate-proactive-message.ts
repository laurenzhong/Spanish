import { randomUUID } from "node:crypto";

import type { CharacterReplyProvider } from "@/src/modules/providers/conversation";
import { getConversationCharacter } from "../domain/character-catalog";
import {
  evaluateProactiveEligibility,
  isProactiveMessageSafe,
  proactiveDedupeKey,
  proactiveReplyPlan,
  type ProactiveMessageSource,
} from "../domain/proactive-message";
import type { ConversationMessageRecord } from "../repositories/conversation-repository";
import type { ProactiveMessageCandidateRecord, ProactiveMessageRepository } from "../repositories/proactive-message-repository";

export type GenerateProactiveMessageResult = Readonly<{
  status: "generated" | "suppressed" | "in-progress" | "failed";
  reason?: string;
  candidate: ProactiveMessageCandidateRecord | null;
  message: ConversationMessageRecord | null;
}>;

export async function generateLuciaProactiveMessage(input: Readonly<{
  userId: string;
  source: ProactiveMessageSource;
  sourceEventId?: string | null;
  now?: Date;
  repository: ProactiveMessageRepository;
  provider?: CharacterReplyProvider;
  memories?: readonly Readonly<{
    factKey: string;
    category: string;
    content: string;
    confidence: number;
    sensitivity: "normal" | "sensitive" | "private";
    shareScope: "private" | "character" | "explicit";
  }>[];
}>): Promise<GenerateProactiveMessageResult> {
  const now = input.now ?? new Date();
  const state = await input.repository.getEligibilityState(input.userId, now);
  const eligibility = evaluateProactiveEligibility(state, now);
  if (!eligibility.allowed) return { status: "suppressed", reason: eligibility.reason, candidate: null, message: null };

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

  const plan = proactiveReplyPlan(input.source, state.relationshipStage);
  if (!input.provider) {
    await input.repository.failCandidate({ userId: input.userId, candidateId: candidate.id, errorCode: "provider-unavailable" });
    return { status: "failed", reason: "provider-unavailable", candidate, message: null };
  }
  try {
    const character = getConversationCharacter("lucia").snapshot;
    const result = await input.provider.generate({
      inputKind: "proactive",
      userMessage: "",
      recentMessages: [],
      character,
      relationshipStage: state.relationshipStage,
      relationshipSummary: state.relationshipSummary,
      memories: input.memories ?? [],
      teachingOpportunity: null,
      questionPolicy: plan.questionPolicy,
      proactiveMessageSource: input.source,
      interactionMode: plan.interactionMode,
      affectionIntensityCeiling: plan.affectionIntensityCeiling,
    });
    if (!isProactiveMessageSafe(result.text, plan)) {
      await input.repository.failCandidate({ userId: input.userId, candidateId: candidate.id, errorCode: "safety-gate" });
      return { status: "failed", reason: "safety-gate", candidate, message: null };
    }
    const completed = await input.repository.completeCandidate({
      userId: input.userId,
      candidateId: candidate.id,
      messageId: randomUUID(),
      generationId,
      content: result.text.trim(),
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
