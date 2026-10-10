import { buildIntroductionOffer, transitionIntroduction, type IntroductionCandidate } from "../domain";
import type { CharacterRelationshipRecord, IntroductionRecord, IntroductionRepository } from "../repositories";

export class IntroductionError extends Error {
  constructor(readonly code: "INTRODUCTION_NOT_AVAILABLE" | "INTRODUCTION_ALREADY_RESOLVED" | "INTRODUCTION_EXPIRED" | "INTRODUCTION_MEMORY_NOT_SHAREABLE") {
    super(code);
    this.name = "IntroductionError";
  }
}

export type IntroductionProposalResult = Readonly<{
  offer: IntroductionRecord | null;
}>;

export async function proposeIntroduction(input: Readonly<{
  repository: IntroductionRepository;
  candidate: IntroductionCandidate;
}>): Promise<IntroductionProposalResult> {
  const offer = buildIntroductionOffer(input.candidate);
  if (!offer) return { offer: null };
  return { offer: await input.repository.createOrGetPending(offer) };
}

export type AcceptIntroductionResult = Readonly<{
  offer: IntroductionRecord;
  relationship: CharacterRelationshipRecord;
  conversationId: string;
  sharedMemoryIds: readonly string[];
}>;

export async function respondToIntroduction(input: Readonly<{
  repository: IntroductionRepository;
  userId: string;
  offerKey: string;
  decision: "accept" | "decline";
  memoryIds?: readonly string[];
}>): Promise<AcceptIntroductionResult | IntroductionRecord> {
  return input.repository.transaction(async (repository) => {
    const existing = await repository.findByKey(input.userId, input.offerKey);
    if (!existing) throw new IntroductionError("INTRODUCTION_NOT_AVAILABLE");
    if (existing.status === "pending" && existing.expiresAt && existing.expiresAt.getTime() <= Date.now()) {
      await repository.resolve(input.userId, input.offerKey, "expired");
      throw new IntroductionError("INTRODUCTION_EXPIRED");
    }
    if (existing.status !== "pending") {
      if (input.decision === "accept" && existing.status === "accepted") return existing;
      throw new IntroductionError("INTRODUCTION_ALREADY_RESOLVED");
    }
    if (input.decision === "decline") {
      return repository.resolve(input.userId, input.offerKey, transitionIntroduction(existing, "decline"));
    }

    const requestedMemoryIds = [...new Set(input.memoryIds ?? [])];
    const sharedMemoryIds = await repository.validateShareableMemories(
      input.userId,
      requestedMemoryIds,
      existing.sourceCharacterKey,
      existing.sourceCharacterVersion,
    );
    if (sharedMemoryIds.length !== requestedMemoryIds.length) {
      throw new IntroductionError("INTRODUCTION_MEMORY_NOT_SHAREABLE");
    }
    const relationship = await repository.ensureRelationship(
      input.userId,
      existing.targetCharacterKey,
      existing.targetCharacterVersion,
    );
    const conversationId = await repository.ensureConversation(
      input.userId,
      existing.targetCharacterKey,
      existing.targetCharacterVersion,
    );
    await repository.grantMemoryPermissions(input.userId, sharedMemoryIds, existing.targetCharacterKey, existing.targetCharacterVersion);
    const offer = await repository.resolve(
      input.userId,
      input.offerKey,
      transitionIntroduction(existing, "accept"),
      sharedMemoryIds,
    );
    return { offer, relationship, conversationId, sharedMemoryIds };
  });
}
