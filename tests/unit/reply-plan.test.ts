import { describe, expect, it, vi } from "vitest";

import {
  buildReplyContext,
  deriveReplyOpenTopics,
  generateCharacterReply,
  planReply,
} from "@/src/modules/conversation";
import type { MemoryRecord } from "@/src/modules/memory";

const memory = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: "memory-1",
  userId: "user-1",
  characterKey: "lucia",
  sourceConversationId: "conversation-1",
  sourceMessageId: "message-1",
  factKey: "interest.preference",
  category: "interest",
  content: "la fotografía",
  confidence: 0.9,
  sensitivity: "normal",
  shareScope: "private",
  status: "candidate",
  createdAt: new Date("2026-08-24T00:00:00.000Z"),
  updatedAt: new Date("2026-08-24T00:00:00.000Z"),
  ...overrides,
});

describe("reply planning", () => {
  it("answers a direct AI identity question honestly before any teaching opportunity", () => {
    const plan = planReply({
      userMessage: "¿Eres una inteligencia artificial?",
      teachingOpportunity: { skillKey: "conversation-maintenance" },
    });
    expect(plan.intent).toBe("identity-disclosure");
    expect(plan.rationale).toBe("be-transparent-about-identity");
    expect(plan.learningOpportunity).toBeNull();
    expect(plan.shouldAskFollowUp).toBe(true);
  });

  it("responds to distress without turning the moment into a lesson", () => {
    const plan = planReply({
      userMessage: "Estoy muy preocupado por mi casero.",
      teachingOpportunity: { skillKey: "repair-communication", preferredStyle: "recast" },
    });
    expect(plan).toMatchObject({
      intent: "emotional-support",
      emotion: "supportive",
      shouldAskFollowUp: true,
      learningOpportunity: null,
    });
  });

  it("keeps the user's topic as the primary intent when a learning opportunity is available", () => {
    const plan = planReply({
      userMessage: "Me gusta la fotografía urbana.",
      characterTopics: ["fotografía urbana"],
      teachingOpportunity: { skillKey: "conversation-maintenance" },
    });
    expect(plan.intent).toBe("acknowledge-and-explore");
    expect(plan.learningOpportunity).toEqual({
      skillKey: "conversation-maintenance",
      style: "follow-up",
      reason: "natural-opening",
    });
  });

  it("marks a place suggestion as an opportunity without inventing a place", () => {
    const plan = planReply({ userMessage: "¿Qué lugar me recomiendas en Madrid?" });
    expect(plan.intent).toBe("answer-and-follow-up");
    expect(plan.shouldSuggestPlace).toBe(true);
    expect(plan.shouldChangeTopic).toBe(false);
  });
});

describe("reply context and deterministic generation", () => {
  it("keeps a bounded recent window while exposing answered and open topics", async () => {
    const history = [
      { role: "user" as const, content: "¿Qué comiste al mediodía?" },
      { role: "character" as const, content: "Comí una ensalada con tomate." },
      { role: "user" as const, content: "¿Qué haces ahora?" },
    ];
    const context = await buildReplyContext({
      generationId: "generation-1",
      userId: "user-1",
      userMessage: "¿Qué vas a comer al mediodía?",
      recentMessages: history,
      recentMessageCharBudget: 60,
    });

    expect(context.recentMessages.length).toBeLessThan(history.length);
    expect(context.openTopics).toEqual(expect.arrayContaining([
      expect.objectContaining({ topicKey: "daily:meal", status: "answered", lastAnswer: "Comí una ensalada con tomate." }),
      expect.objectContaining({ topicKey: "daily:activity", status: "open" }),
    ]));
    expect(deriveReplyOpenTopics(history)).toHaveLength(2);
  });

  it("marks a previously answered topic as occurring on the same local day", async () => {
    const context = await buildReplyContext({
      generationId: "generation-time",
      userId: "user-1",
      userMessage: "¿Qué vas a comer para almorzar?",
      now: new Date("2026-08-29T12:30:00.000Z"),
      recentMessages: [
        { role: "user", content: "¿Qué vas a comer para almorzar?", sentAt: "2026-08-29T10:00:00.000Z" },
        { role: "character", content: "Todavía no lo he decidido.", sentAt: "2026-08-29T10:01:00.000Z" },
      ],
    });
    expect(context.currentLocalDate).toBe("2026-08-29");
    expect(context.conversationTimeZone).toBe("Europe/Madrid");
    expect(context.openTopics).toEqual([
      expect.objectContaining({ topicKey: "daily:meal", sameLocalDay: true, lastAskedAt: "2026-08-29T10:00:00.000Z" }),
    ]);
  });

  it("keeps Lucía's recent same-day self-report separate from user memories", async () => {
    const context = await buildReplyContext({
      generationId: "generation-claim",
      userId: "user-1",
      userMessage: "¿Qué vas a comer?",
      now: new Date("2026-08-29T12:30:00.000Z"),
      recentMessages: [
        { role: "user", content: "¿Qué vas a comer?", sentAt: "2026-08-29T10:00:00.000Z" },
        { role: "character", content: "Creo que comeré puré de patatas.", sentAt: "2026-08-29T10:01:00.000Z" },
      ],
    });
    expect(context.characterClaims).toEqual([
      expect.objectContaining({ claimKey: "daily:meal", claimKind: "daily_observation", statement: "Creo que comeré puré de patatas.", sameLocalDay: true, repeatableOnLaterDays: true }),
    ]);
    expect(context.memories).toEqual([]);
  });

  it("allows a repeatable daily observation to recur on a later local day", async () => {
    const context = await buildReplyContext({
      generationId: "generation-next-day",
      userId: "user-1",
      userMessage: "¿Qué vas a desayunar?",
      now: new Date("2026-08-30T08:30:00.000Z"),
      recentMessages: [
        { role: "character", content: "Esta mañana he tomado café.", sentAt: "2026-08-29T07:30:00.000Z" },
      ],
    });
    expect(context.characterClaims).toEqual([
      expect.objectContaining({ claimKey: "daily:drink", repeatableOnLaterDays: true, sameLocalDay: false }),
    ]);
  });

  it("uses the readable memory projection and excludes rejected or conflicting facts", async () => {
    const listReadableMemories = vi.fn().mockResolvedValue([
      memory(),
      memory({ id: "memory-2", status: "rejected", content: "un dato rechazado" }),
      memory({ id: "memory-3", status: "conflict", content: "un dato contradictorio" }),
      memory({ id: "memory-4", characterKey: "mateo", content: "un secreto privado" }),
      memory({ id: "memory-5", characterKey: "mateo", shareScope: "explicit", content: "un dato compartido" }),
    ]);
    const context = await buildReplyContext({
      generationId: "generation-1",
      userId: "user-1",
      userMessage: "Hola",
      memoryRepository: { listReadableMemories } as never,
    });
    expect(listReadableMemories).toHaveBeenCalledWith("user-1", "lucia");
    expect(context.character.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ factKey: "boundary.ai-identity", reveal: "direct" }),
    ]));
    expect(context.memories).toEqual([
      expect.objectContaining({ factKey: "interest.preference", content: "la fotografía" }),
      expect.objectContaining({ content: "un dato compartido", shareScope: "explicit" }),
    ]);
  });

  it("keeps the established greeting surface while exposing the structured plan", async () => {
    const context = await buildReplyContext({
      generationId: "generation-1",
      userId: "user-1",
      userMessage: "Hola",
    });
    const result = generateCharacterReply({ context });
    expect(result.plan.intent).toBe("greeting");
    expect(result.text).toBe("¡Hola! Qué alegría leerte. Yo estoy bien; ¿cómo va todo por tu lado?");
  });

  it("does not generate after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const context = await buildReplyContext({
      generationId: "generation-1",
      userId: "user-1",
      userMessage: "Hola",
    });
    expect(() => generateCharacterReply({ context, signal: controller.signal })).toThrow("REPLY_GENERATION_ABORTED");
  });
});
