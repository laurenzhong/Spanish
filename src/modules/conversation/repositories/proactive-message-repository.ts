import type { ConversationMessageRecord } from "./conversation-repository";
import type { ProactiveEligibilityState, ProactiveMessageSource } from "../domain/proactive-message";

export type ProactiveCandidateStatus = "pending" | "generating" | "generated" | "suppressed" | "failed" | "expired";

export type ProactiveMessageCandidateRecord = Readonly<{
  id: string;
  userId: string;
  characterKey: "lucia";
  conversationId: string;
  sourceType: ProactiveMessageSource;
  dedupeKey: string;
  generationId: string;
  notBefore: Date;
  expiresAt: Date | null;
  status: ProactiveCandidateStatus;
  messageId: string | null;
  notificationStatus: "not_requested" | "pending" | "delivered" | "failed" | "suppressed";
  lastErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProactiveMessageRepository = Readonly<{
  getConversationId(userId: string): Promise<string>;
  getEligibilityState(userId: string, now: Date): Promise<ProactiveEligibilityState>;
  createCandidate(input: Readonly<{
    userId: string;
    conversationId: string;
    sourceType: ProactiveMessageSource;
    dedupeKey: string;
    generationId: string;
    notBefore: Date;
    expiresAt?: Date | null;
  }>): Promise<ProactiveMessageCandidateRecord>;
  completeCandidate(input: Readonly<{
    userId: string;
    candidateId: string;
    messageId: string;
    generationId: string;
    content: string;
  }>): Promise<{ candidate: ProactiveMessageCandidateRecord; message: ConversationMessageRecord }>;
  failCandidate(input: Readonly<{ userId: string; candidateId: string; errorCode: string }>): Promise<void>;
}>;
