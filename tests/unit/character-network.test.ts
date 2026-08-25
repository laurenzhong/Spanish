import { describe, expect, it } from "vitest";

import {
  buildIntroductionOffer,
  proposeIntroduction,
  respondToIntroduction,
  transitionIntroduction,
  type CharacterRelationshipRecord,
  type IntroductionRecord,
  type IntroductionRepository,
} from "@/src/modules/character-network";

const baseCandidate = {
  userId: "user-a",
  sourceCharacterKey: "lucia" as const,
  sourceCharacterVersion: 1 as const,
  targetCharacterKey: "mateo" as const,
  targetCharacterVersion: 1 as const,
};

type MutableRepository = { -readonly [Key in keyof IntroductionRepository]: IntroductionRepository[Key] };

function fakeRepository(): Readonly<{ repository: IntroductionRepository; relationships: Map<string, CharacterRelationshipRecord> }> {
  const records = new Map<string, IntroductionRecord>();
  const relationships = new Map<string, CharacterRelationshipRecord>();
  const shared = new Set<string>();
  let sequence = 0;
  const repository = {} as MutableRepository;
  repository.transaction = async (work) => work(repository);
  repository.createOrGetPending = async (offer) => {
    const existing = records.get(`${offer.userId}:${offer.offerKey}`);
    if (existing) return existing;
    const now = new Date("2026-08-25T00:00:00Z");
    const record = { ...offer, id: `offer-${++sequence}`, expiresAt: null, createdAt: now, updatedAt: now };
    records.set(`${offer.userId}:${offer.offerKey}`, record);
    return record;
  };
  repository.findByKey = async (userId, offerKey) => records.get(`${userId}:${offerKey}`) ?? null;
  repository.listPending = async (userId) => [...records.values()].filter((record) => record.userId === userId && record.status === "pending");
  repository.resolve = async (userId, offerKey, status, acceptedMemoryIds = []) => {
    const key = `${userId}:${offerKey}`;
    const current = records.get(key);
    if (!current) throw new Error("INTRODUCTION_NOT_AVAILABLE");
    const next = { ...current, status, acceptedMemoryIds, updatedAt: new Date("2026-08-25T00:01:00Z") };
    records.set(key, next);
    return next;
  };
  repository.ensureRelationship = async (userId, characterKey) => {
    const key = `${userId}:${characterKey}`;
    const existing = relationships.get(key);
    if (existing) return existing;
    const created = { id: `relationship-${characterKey}`, userId, characterKey, relationshipStage: "new_contact" as const, revealedCanonFactKeys: [] };
    relationships.set(key, created);
    return created;
  };
  repository.ensureConversation = async (userId, characterKey) => `conversation-${userId}-${characterKey}`;
  repository.validateShareableMemories = async (_userId, memoryIds) => memoryIds.filter((memoryId) => memoryId !== "private-memory");
  repository.grantMemoryPermissions = async (_userId, memoryIds) => { memoryIds.forEach((memoryId) => shared.add(memoryId)); };
  return { repository: repository as IntroductionRepository, relationships };
}

describe("character network introductions", () => {
  it("does not offer an introduction without a real contextual reason", () => {
    expect(buildIntroductionOffer({ ...baseCandidate, recentMessages: [{ role: "user", content: "Hola, ¿qué tal?" }] })).toBeNull();
  });

  it("creates a stable offer when a shared interest is present", () => {
    const first = buildIntroductionOffer({ ...baseCandidate, recentMessages: [{ role: "user", content: "Me encanta la fotografía urbana" }] });
    const second = buildIntroductionOffer({ ...baseCandidate, recentMessages: [{ role: "user", content: "Me encanta la fotografía urbana" }] });
    expect(first?.reasonCode).toBe("shared-interest");
    expect(first?.offerKey).toBe(second?.offerKey);
  });

  it("rejects resolving an offer that is no longer pending", () => {
    expect(() => transitionIntroduction({ status: "accepted" }, "decline")).toThrow("INTRODUCTION_ALREADY_RESOLVED");
  });

  it("does not create a relationship when the user declines", async () => {
    const { repository, relationships } = fakeRepository();
    const { offer } = await proposeIntroduction({ repository, candidate: { ...baseCandidate, recentMessages: [{ role: "user", content: "Me gusta la música" }] } });
    const declined = await respondToIntroduction({ repository, userId: "user-a", offerKey: offer!.offerKey, decision: "decline" });
    expect((declined as IntroductionRecord).status).toBe("declined");
    expect(relationships.size).toBe(0);
  });

  it("accepts once, creates an independent relationship, and shares only selected safe memories", async () => {
    const { repository } = fakeRepository();
    const { offer } = await proposeIntroduction({ repository, candidate: { ...baseCandidate, recentMessages: [{ role: "user", content: "Estoy pensando en una mudanza" }] } });
    const accepted = await respondToIntroduction({ repository, userId: "user-a", offerKey: offer!.offerKey, decision: "accept", memoryIds: ["safe-memory"] });
    expect(accepted).toEqual(expect.objectContaining({ sharedMemoryIds: ["safe-memory"], conversationId: "conversation-user-a-mateo" }));
    const repeated = await respondToIntroduction({ repository, userId: "user-a", offerKey: offer!.offerKey, decision: "accept", memoryIds: ["safe-memory"] });
    expect((repeated as IntroductionRecord).status).toBe("accepted");
  });

  it("rejects a private memory before creating the relationship", async () => {
    const { repository, relationships } = fakeRepository();
    const { offer } = await proposeIntroduction({ repository, candidate: { ...baseCandidate, recentMessages: [{ role: "user", content: "Me encanta la fotografía" }] } });
    await expect(respondToIntroduction({ repository, userId: "user-a", offerKey: offer!.offerKey, decision: "accept", memoryIds: ["private-memory"] })).rejects.toMatchObject({ code: "INTRODUCTION_MEMORY_NOT_SHAREABLE" });
    expect(relationships.size).toBe(0);
  });
});
