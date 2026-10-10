import { describe, expect, it, vi } from "vitest";

import {
  evaluateProactiveEligibility,
  generateLuciaProactiveMessage,
  previewLuciaProactiveMessage,
  isProactiveMessageSafe,
  proactiveReplyPlan,
  type ProactiveMessageCandidateRecord,
  type ProactiveMessageRepository,
} from "@/src/modules/conversation";
import { ConversationProviderError } from "@/src/modules/providers/conversation";

const now = new Date("2026-08-29T10:00:00.000Z");

function state(overrides: Partial<Parameters<typeof evaluateProactiveEligibility>[0]> = {}) {
  return {
    relationshipStatus: "active" as const,
    relationshipStage: "familiar" as const,
    relationshipSummary: "Hablamos de fotografía urbana.",
    proactiveEnabled: true,
    lastInteractionAt: new Date("2026-08-28T10:00:00.000Z"),
    lastProactiveMessageAt: null,
    proactiveCount24h: 0,
    proactiveCount7d: 0,
    hasUnansweredProactive: false,
    ...overrides,
  };
}

describe("proactive message policy", () => {
  it("enforces relationship, cooldown and frequency limits", () => {
    expect(evaluateProactiveEligibility(state({ relationshipStatus: "inactive" }), now)).toMatchObject({ allowed: false, reason: "relationship-inactive" });
    expect(evaluateProactiveEligibility(state({ proactiveCount24h: 3 }), now)).toMatchObject({ allowed: false, reason: "daily-limit" });
    expect(evaluateProactiveEligibility(state({ proactiveCount7d: 12 }), now)).toMatchObject({ allowed: false, reason: "weekly-limit" });
    expect(evaluateProactiveEligibility(state({ lastProactiveMessageAt: new Date("2026-08-29T09:00:00.000Z") }), now)).toMatchObject({ allowed: false, reason: "cooldown" });
    // main's production fix (`ab2b820`): a recent unanswered message still
    // suppresses sending, but only inside the bounded window (see the next case
    // for the stale-message regression).
    expect(evaluateProactiveEligibility(state({ hasUnansweredProactive: true, lastProactiveMessageAt: new Date("2026-08-29T08:00:00.000Z") }), now)).toMatchObject({ allowed: false, reason: "unanswered-message" });
    expect(evaluateProactiveEligibility(state(), now)).toEqual({ allowed: true, reason: "eligible" });
  });

  it("does not let a single unanswered message silence the character forever", () => {
    const staleUnanswered = state({
      hasUnansweredProactive: true,
      lastProactiveMessageAt: new Date("2026-08-27T10:00:00.000Z"),
      proactiveCount7d: 1,
    });
    expect(evaluateProactiveEligibility(staleUnanswered, now)).toEqual({ allowed: true, reason: "eligible" });
  });

  it("allows one low-pressure question only in the daily check-in plan", () => {
    const dailyShare = proactiveReplyPlan("daily_share", "familiar");
    expect(dailyShare.questionPolicy).toEqual({ maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" });
    expect(isProactiveMessageSafe("Hola, ¿qué tal el día por ahí?", dailyShare)).toBe(true);
    expect(isProactiveMessageSafe("¿Qué tal? ¿Y tú? ¿Has comido bien?", dailyShare)).toBe(false);

    const quietPresence = proactiveReplyPlan("quiet_presence", "familiar");
    expect(quietPresence.questionPolicy).toEqual({ maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" });
    expect(isProactiveMessageSafe("Hola, ¿qué tal el día?", quietPresence)).toBe(false);

    // MiniMax-M3 sometimes leaks a word from another writing system.
    expect(isProactiveMessageSafe("Hoy vi una fachada preciosa, casi me quedo ahí plantada con el móvil随机.", dailyShare)).toBe(false);
  });

  it("keeps unsolicited text low-pressure and rejects product meta or questions", () => {
    const plan = proactiveReplyPlan("spontaneous_affection", "familiar");
    expect(isProactiveMessageSafe("Me has venido a la cabeza de repente. Solo quería saludarte.", plan)).toBe(false);
    expect(isProactiveMessageSafe("Me apetecía saludarte y sacarte una sonrisa.", plan)).toBe(true);
    expect(isProactiveMessageSafe("Me alegra mucho; me apetecía dejarte una sonrisa pequeña.", plan)).toBe(false);
    expect(isProactiveMessageSafe("¿Me echas de menos?", plan)).toBe(false);
    expect(isProactiveMessageSafe("Me gusta cuando me eliges para hablar.", plan)).toBe(false);
    const morningPlan = proactiveReplyPlan("spontaneous_affection", "familiar", "waking");
    expect(morningPlan.preferredLength).toBe("one-line");
    expect(isProactiveMessageSafe("Te echo de menos.", morningPlan)).toBe(true);
    expect(isProactiveMessageSafe("Te echo de menos. Ojalá tengas un día tranquilo y bonito.", morningPlan)).toBe(true);
    expect(isProactiveMessageSafe("Te echo de menos. ¿Cómo has dormido?", morningPlan)).toBe(false);
    expect(isProactiveMessageSafe("Hoy he salido a caminar un rato. ¿Cómo va tu día?", proactiveReplyPlan("daily_share", "familiar"))).toBe(true);
    expect(isProactiveMessageSafe("¿Cómo va tu día? ¿Y el trabajo?", proactiveReplyPlan("daily_share", "familiar"))).toBe(false);
  });

  it("requires unsolicited text to be pure Spanish", () => {
    const plan = proactiveReplyPlan("daily_share", "familiar");
    // Regression: the reported live message, including the Chinese word.
    expect(isProactiveMessageSafe("Oye, me crucé con una fachada con azulejos increíbles en Malasaña, casi me quedo ahí plantada con el móvil. ¿Tú sueles parar a fotografiar cosas随机 de la calle?", plan)).toBe(false);
    expect(isProactiveMessageSafe("Hoy he salido a caminar un rato随机.", plan)).toBe(false);
    expect(isProactiveMessageSafe("随机", plan)).toBe(false);
    expect(isProactiveMessageSafe("Hoy he salido a caminar un rato. ¿Cómo va tu día?", plan)).toBe(true);
  });
});

describe("generateLuciaProactiveMessage", () => {
  it("supports a non-persisting preview for development voice checks", async () => {
    const repository: ProactiveMessageRepository = {
      getConversationId: vi.fn(),
      getEligibilityState: vi.fn().mockResolvedValue(state()),
      createCandidate: vi.fn(),
      completeCandidate: vi.fn(),
      failCandidate: vi.fn(),
    };
    const provider = { generate: vi.fn().mockResolvedValue({ text: "Te echo de menos.", provider: "openai", modelVersion: "gpt-5.6-sol", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }) };
    const result = await previewLuciaProactiveMessage({ userId: "user-1", source: "spontaneous_affection", dailyState: "waking", repository, provider });
    expect(result).toEqual({ status: "preview", text: "Te echo de menos." });
    expect(repository.createCandidate).not.toHaveBeenCalled();
    expect(repository.completeCandidate).not.toHaveBeenCalled();
  });

  it("passes a provider-neutral proactive context and persists only safe output", async () => {
    const candidate: ProactiveMessageCandidateRecord = {
      id: "candidate-1",
      userId: "user-1",
      characterKey: "lucia",
      conversationId: "conversation-1",
      sourceType: "spontaneous_affection",
      dedupeKey: "lucia:spontaneous_affection:2026-08-29",
      generationId: "generation-1",
      notBefore: now,
      expiresAt: null,
      status: "generating",
      messageId: null,
      notificationStatus: "not_requested",
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const repository: ProactiveMessageRepository = {
      getConversationId: vi.fn().mockResolvedValue("conversation-1"),
      getEligibilityState: vi.fn().mockResolvedValue(state()),
      createCandidate: vi.fn().mockImplementation(async (input) => ({ ...candidate, generationId: input.generationId })),
      completeCandidate: vi.fn().mockResolvedValue({
        candidate: { ...candidate, status: "generated", messageId: "message-1" },
        message: {
          id: "message-1", clientMessageId: "proactive-candidate-1", generationId: "generation-1", role: "character", status: "completed", content: "Me acordé de ti esta mañana.", replyToMessageId: null, createdAt: now, completedAt: now, sourceType: "proactive",
        },
      }),
      failCandidate: vi.fn(),
    };
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Me acordé de ti esta mañana.", provider: "openai", modelVersion: "gpt-5.6-sol", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "spontaneous_affection", dailyState: "waking", now, repository, provider });
    expect(result.status).toBe("generated");
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ inputKind: "proactive", userMessage: "", dailyState: "waking", preferredLength: "one-line", proactiveMessageSource: "spontaneous_affection", questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" } }));
    expect(repository.completeCandidate).toHaveBeenCalledTimes(1);
  });

  it("fails a candidate whose provider text mixes in Chinese", async () => {
    const repository: ProactiveMessageRepository = {
      getConversationId: vi.fn().mockResolvedValue("conversation-1"),
      getEligibilityState: vi.fn().mockResolvedValue(state()),
      createCandidate: vi.fn().mockImplementation(async (input) => ({
        id: "candidate-1", userId: "user-1", characterKey: "lucia", conversationId: "conversation-1",
        sourceType: input.sourceType, dedupeKey: input.dedupeKey, generationId: input.generationId,
        notBefore: input.notBefore, expiresAt: input.expiresAt, status: "generating", messageId: null,
        notificationStatus: "not_requested", lastErrorCode: null, createdAt: now, updatedAt: now,
      })),
      completeCandidate: vi.fn(),
      failCandidate: vi.fn(),
    };
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Me apetecía saludarte随机.", provider: "minimax", modelVersion: "MiniMax-M3", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", now, repository, provider });
    expect(result).toMatchObject({ status: "failed", reason: "safety-gate", message: null });
    expect(repository.completeCandidate).not.toHaveBeenCalled();
    expect(repository.failCandidate).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "safety-gate" }));
  });

  it("does not call a provider when policy suppresses the message", async () => {
    const repository: ProactiveMessageRepository = {
      getConversationId: vi.fn(),
      // Keep the suppression reason unambiguous: this case asserts the daily
      // cap, so the state must not also carry a recent unanswered message.
      getEligibilityState: vi.fn().mockResolvedValue(state({ proactiveCount24h: 3 })),
      createCandidate: vi.fn(),
      completeCandidate: vi.fn(),
      failCandidate: vi.fn(),
    };
    const provider = { generate: vi.fn() };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "quiet_presence", now, repository, provider });
    expect(result).toMatchObject({ status: "suppressed", reason: "daily-limit" });
    expect(repository.createCandidate).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("reports the provider error code and a bounded detail when generation fails", async () => {
    const candidate: ProactiveMessageCandidateRecord = {
      id: "candidate-1",
      userId: "user-1",
      characterKey: "lucia",
      conversationId: "conversation-1",
      sourceType: "daily_share",
      dedupeKey: "lucia:daily_share:2026-08-29",
      generationId: "generation-1",
      notBefore: now,
      expiresAt: null,
      status: "generating",
      messageId: null,
      notificationStatus: "not_requested",
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };
    const repository: ProactiveMessageRepository = {
      getConversationId: vi.fn().mockResolvedValue("conversation-1"),
      getEligibilityState: vi.fn().mockResolvedValue(state()),
      createCandidate: vi.fn().mockImplementation(async (input) => ({ ...candidate, generationId: input.generationId })),
      completeCandidate: vi.fn(),
      failCandidate: vi.fn(),
    };
    const provider = {
      generate: vi.fn().mockRejectedValue(new ConversationProviderError("provider-unavailable", "Conversation provider is temporarily unavailable (HTTP 503).", true)),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", now, repository, provider });
    expect(result).toMatchObject({ status: "failed", reason: "provider-unavailable", detail: "ConversationProviderError: Conversation provider is temporarily unavailable (HTTP 503)." });
    expect(repository.failCandidate).toHaveBeenCalledWith({ userId: "user-1", candidateId: "candidate-1", errorCode: "provider-unavailable" });
  });
});

