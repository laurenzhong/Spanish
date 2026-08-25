import type { IntroductionOffer } from "../domain";

export type IntroductionRecord = Readonly<IntroductionOffer & {
  id: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CharacterRelationshipRecord = Readonly<{
  id: string;
  userId: string;
  characterKey: string;
  relationshipStage: "new_contact" | "getting_to_know_you" | "familiar" | "close_friend";
  revealedCanonFactKeys: readonly string[];
}>;

export type ShareableMemoryPreview = Readonly<{
  id: string;
  characterKey: string;
  targetCharacterKey?: string;
  category: string;
  content: string;
  sensitivity: "normal" | "sensitive";
  alreadyShared: boolean;
}>;

export type IntroductionRepository = Readonly<{
  transaction<T>(work: (repository: IntroductionRepository) => Promise<T>): Promise<T>;
  createOrGetPending(offer: IntroductionOffer): Promise<IntroductionRecord>;
  findByKey(userId: string, offerKey: string): Promise<IntroductionRecord | null>;
  listPending(userId: string): Promise<readonly IntroductionRecord[]>;
  resolve(userId: string, offerKey: string, status: "accepted" | "declined" | "expired", acceptedMemoryIds?: readonly string[]): Promise<IntroductionRecord>;
  ensureRelationship(userId: string, characterKey: string, characterVersion: number): Promise<CharacterRelationshipRecord>;
  ensureConversation(userId: string, characterKey: string, characterVersion: number): Promise<string>;
  validateShareableMemories(userId: string, memoryIds: readonly string[], sourceCharacterKey: string): Promise<readonly string[]>;
  grantMemoryPermissions(userId: string, memoryIds: readonly string[], targetCharacterKey: string): Promise<void>;
  listShareableMemoryPreviews(userId: string, sourceCharacterKey: string, targetCharacterKey: string): Promise<readonly ShareableMemoryPreview[]>;
  listGrantedMemoryPreviews(userId: string): Promise<readonly ShareableMemoryPreview[]>;
  revokeMemoryPermission(userId: string, memoryId: string, targetCharacterKey: string): Promise<void>;
}>;
