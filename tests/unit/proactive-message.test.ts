import { describe, expect, it, vi } from "vitest";

import {
  evaluateProactiveEligibility,
  generateLuciaProactiveMessage,
  previewLuciaProactiveMessage,
  isProactiveMessageSafe,
  proactiveReplyPlan,
  repeatsAnsweredQuestion,
  type ConversationMessageRecord,
  type ProactiveMessageCandidateRecord,
  type ProactiveMessageRepository,
} from "@/src/modules/conversation";
import { getConversationCharacter } from "@/src/modules/conversation/domain/character-catalog";

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

function conversationMessage(role: "user" | "character", content: string, createdAt: string): ConversationMessageRecord {
  return {
    id: `message-${role}-${createdAt}`,
    clientMessageId: `client-${role}-${createdAt}`,
    generationId: null,
    role,
    status: "completed",
    content,
    replyToMessageId: null,
    createdAt: new Date(createdAt),
    completedAt: new Date(createdAt),
    sourceType: "conversation",
  };
}

function repositoryFixture(overrides: Partial<ProactiveMessageRepository> = {}): ProactiveMessageRepository {
  return {
    getConversationId: vi.fn().mockResolvedValue("conversation-1"),
    listRecentMessages: vi.fn().mockResolvedValue([]),
    getEligibilityState: vi.fn().mockResolvedValue(state()),
    createCandidate: vi.fn(),
    completeCandidate: vi.fn(),
    failCandidate: vi.fn(),
    ...overrides,
  };
}

const photographyHistory = [
  conversationMessage("character", "¡Qué bien! Es uno de mis temas favoritos. ¿Buscas más bien retratos espontáneos o escenas más posadas?", "2026-08-16T15:58:08.000Z"),
  conversationMessage("user", "A mí me gusta fotografiar temas de gente y paisajes.", "2026-08-17T03:18:54.000Z"),
  conversationMessage("character", "¡Genial! La gente y los paisajes son una combinación muy bonita. ¿Qué tipo de paisajes te llaman más, urbanos o más naturales?", "2026-08-17T03:18:54.940Z"),
] as const;

describe("proactive message policy", () => {
  it("waits for the first completed user message after the contact opening", () => {
    expect(evaluateProactiveEligibility(state({ relationshipStage: "new_contact", lastInteractionAt: null }), now))
      .toEqual({ allowed: false, reason: "awaiting-first-user-message" });
    expect(evaluateProactiveEligibility(state({ lastInteractionAt: null }), now))
      .toEqual({ allowed: false, reason: "awaiting-first-user-message" });
    expect(evaluateProactiveEligibility(state({ relationshipStage: "new_contact" }), now))
      .toEqual({ allowed: true, reason: "eligible" });
  });

  it("enforces relationship, cooldown and frequency limits", () => {
    expect(evaluateProactiveEligibility(state({ relationshipStatus: "inactive" }), now)).toMatchObject({ allowed: false, reason: "relationship-inactive" });
    expect(evaluateProactiveEligibility(state({ proactiveCount24h: 3 }), now)).toMatchObject({ allowed: false, reason: "daily-limit" });
    expect(evaluateProactiveEligibility(state({ proactiveCount7d: 12 }), now)).toMatchObject({ allowed: false, reason: "weekly-limit" });
    expect(evaluateProactiveEligibility(state({ lastProactiveMessageAt: new Date("2026-08-29T09:00:00.000Z") }), now)).toMatchObject({ allowed: false, reason: "cooldown" });
    expect(evaluateProactiveEligibility(state({ hasUnansweredProactive: true }), now)).toEqual({ allowed: true, reason: "eligible" });
    expect(evaluateProactiveEligibility(state(), now)).toEqual({ allowed: true, reason: "eligible" });
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

  it("detects a proactive question whose options the user already answered", () => {
    // Regression: on 2026-10-19 the user had already written "me gusta
    // fotografiar temas de gente y paisajes" before this unsolicited question.
    expect(repeatsAnsweredQuestion(photographyHistory, "Hoy salí a caminar por Madrid con la cámara. ¿Tú sueles disparar más a gente o a paisajes?")).toBe(true);
    // Asking about a genuinely new preference is allowed.
    expect(repeatsAnsweredQuestion(photographyHistory, "Hoy salí a caminar por Madrid con la cámara. ¿Prefieres la luz de la mañana o la del atardecer?")).toBe(false);
    // One already-known option plus a new one is still a new question.
    expect(repeatsAnsweredQuestion([conversationMessage("user", "Me gusta fotografiar gente por la calle.", "2026-08-17T03:18:54.000Z")], "¿Prefieres fotografiar gente o paisajes?")).toBe(false);
    // No history means no guess.
    expect(repeatsAnsweredQuestion([], "¿Tú sueles disparar más a gente o a paisajes?")).toBe(false);
    // A near-verbatim repeat of a question the character already asked and the
    // user answered is rejected even without a disjunction.
    expect(repeatsAnsweredQuestion([
      conversationMessage("character", "¿Qué tipo de paisajes te llaman más, urbanos o naturales?", "2026-08-17T03:18:54.940Z"),
      conversationMessage("user", "Más naturales, sobre todo el campo.", "2026-08-17T03:20:00.000Z"),
    ], "¿Qué tipo de paisajes te llaman más, urbanos o naturales?")).toBe(true);
  });
});

describe("generateLuciaProactiveMessage", () => {
  it("does not create a candidate or call a provider before the first user reply", async () => {
    const repository = repositoryFixture({
      getEligibilityState: vi.fn().mockResolvedValue(state({ relationshipStage: "new_contact", lastInteractionAt: null })),
    });
    const provider = { generate: vi.fn() };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result).toMatchObject({ status: "suppressed", reason: "awaiting-first-user-message", message: null });
    expect(repository.getConversationId).not.toHaveBeenCalled();
    expect(repository.createCandidate).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it.each(["preview", "generate"] as const)("uses the supplied published snapshot for %s instead of the static catalog", async (mode) => {
    const character = { ...getConversationCharacter("lucia").snapshot, characterVersion: 3, tone: ["voz de la revisión publicada"], topics: ["cine"] };
    const repository = repositoryFixture({
      createCandidate: vi.fn().mockImplementation(async (candidate) => ({ ...candidate, id: "candidate-1", status: "generating" })),
      completeCandidate: vi.fn().mockResolvedValue({ candidate: {}, message: {} }),
    });
    const provider = { generate: vi.fn().mockResolvedValue({ text: "Me apetecía compartir una pequeña alegría contigo.", provider: "minimax", modelVersion: "fake", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null }) };
    const input = { userId: "user-1", source: "quiet_presence" as const, repository, provider, character, now };
    await (mode === "preview" ? previewLuciaProactiveMessage(input) : generateLuciaProactiveMessage(input));
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ character }));
  });

  it.each(["preview", "generate"] as const)("fails closed without a runtime snapshot for %s", async (mode) => {
    const repository = repositoryFixture();
    const provider = { generate: vi.fn() };
    const input = { userId: "user-1", source: "quiet_presence" as const, repository, provider, now };
    const result = await (mode === "preview" ? previewLuciaProactiveMessage(input) : generateLuciaProactiveMessage(input));
    expect(result).toMatchObject({ status: "failed", reason: "character-runtime-unavailable" });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repository.createCandidate).not.toHaveBeenCalled();
  });

  it("supports a non-persisting preview for development voice checks", async () => {
    const repository = repositoryFixture();
    const provider = { generate: vi.fn().mockResolvedValue({ text: "Te echo de menos.", provider: "openai", modelVersion: "gpt-5.6-sol", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }) };
    const result = await previewLuciaProactiveMessage({ userId: "user-1", source: "spontaneous_affection", dailyState: "waking", repository, provider, character: getConversationCharacter("lucia").snapshot, now });
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
    const repository = repositoryFixture({
      createCandidate: vi.fn().mockImplementation(async (input) => ({ ...candidate, generationId: input.generationId })),
      completeCandidate: vi.fn().mockResolvedValue({
        candidate: { ...candidate, status: "generated", messageId: "message-1" },
        message: {
          id: "message-1", clientMessageId: "proactive-candidate-1", generationId: "generation-1", role: "character", status: "completed", content: "Me acordé de ti esta mañana.", replyToMessageId: null, createdAt: now, completedAt: now, sourceType: "proactive",
        },
      }),
    });
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Me acordé de ti esta mañana.", provider: "openai", modelVersion: "gpt-5.6-sol", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "spontaneous_affection", dailyState: "waking", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result.status).toBe("generated");
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({ inputKind: "proactive", userMessage: "", dailyState: "waking", preferredLength: "one-line", proactiveMessageSource: "spontaneous_affection", questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" } }));
    expect(repository.completeCandidate).toHaveBeenCalledTimes(1);
  });

  it("gives the provider the recent conversation instead of an empty context", async () => {
    const repository = repositoryFixture({
      listRecentMessages: vi.fn().mockResolvedValue(photographyHistory),
      createCandidate: vi.fn().mockImplementation(async (candidate) => ({ ...candidate, id: "candidate-1", status: "generating" })),
      completeCandidate: vi.fn().mockResolvedValue({ candidate: {}, message: {} }),
    });
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Hoy me he fijado en una fachada con una luz muy rara; me ha recordado a tus paseos con la cámara.", provider: "minimax", modelVersion: "fake", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", dailyState: "waking", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result.status).toBe("generated");
    expect(provider.generate).toHaveBeenCalledWith(expect.objectContaining({
      recentMessages: photographyHistory.map((message) => expect.objectContaining({ role: message.role, content: message.content })),
      conversationTimeZone: "Europe/Madrid",
      currentLocalDate: "2026-08-29",
      continuityInstruction: expect.stringContaining("recentMessages"),
    }));
  });

  it("rejects a proactive question the user already answered and retries once", async () => {
    const repository = repositoryFixture({
      listRecentMessages: vi.fn().mockResolvedValue(photographyHistory),
      createCandidate: vi.fn().mockImplementation(async (candidate) => ({ ...candidate, id: "candidate-1", status: "generating" })),
      completeCandidate: vi.fn().mockResolvedValue({ candidate: {}, message: {} }),
    });
    const reported = "Hoy salí a caminar por Madrid con la cámara y me crucé con un escaparate que tenía una luz rara, entre naranja y sucia, que daba un rollo muy años 70. Me quedé un rato ahí hasta que el dueño salió a mirarme raro. ¿Tú sueles disparar más a gente o a paisajes?";
    const corrected = "Hoy me he fijado en una luz muy rara en un escaparate del centro; me ha recordado a tus paseos con la cámara.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: reported, provider: "minimax", modelVersion: "fake", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax", modelVersion: "fake", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", dailyState: "available", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result.status).toBe("generated");
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate).toHaveBeenLastCalledWith(expect.objectContaining({ continuityInstruction: expect.stringContaining("repetía una pregunta") }));
    expect(repository.completeCandidate).toHaveBeenCalledWith(expect.objectContaining({ content: corrected }));
  });

  it("fails the candidate when the retry still repeats an answered question", async () => {
    const repository = repositoryFixture({
      listRecentMessages: vi.fn().mockResolvedValue(photographyHistory),
      createCandidate: vi.fn().mockImplementation(async (candidate) => ({ ...candidate, id: "candidate-1", status: "generating" })),
    });
    const repeated = "Otra vez por aquí. ¿Tú sueles disparar más a gente o a paisajes?";
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: repeated, provider: "minimax", modelVersion: "fake", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result).toMatchObject({ status: "failed", reason: "safety-gate", message: null });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(repository.completeCandidate).not.toHaveBeenCalled();
    expect(repository.failCandidate).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "safety-gate" }));
  });

  it("fails a candidate whose provider text mixes in Chinese", async () => {
    const repository = repositoryFixture({
      createCandidate: vi.fn().mockImplementation(async (input) => ({
        id: "candidate-1", userId: "user-1", characterKey: "lucia", conversationId: "conversation-1",
        sourceType: input.sourceType, dedupeKey: input.dedupeKey, generationId: input.generationId,
        notBefore: input.notBefore, expiresAt: input.expiresAt, status: "generating", messageId: null,
        notificationStatus: "not_requested", lastErrorCode: null, createdAt: now, updatedAt: now,
      })),
    });
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Me apetecía saludarte随机.", provider: "minimax", modelVersion: "MiniMax-M3", providerRequestId: null, latencyMs: 10, estimatedCostMicros: null }),
    };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "daily_share", now, repository, provider, character: getConversationCharacter("lucia").snapshot });
    expect(result).toMatchObject({ status: "failed", reason: "safety-gate", message: null });
    expect(repository.completeCandidate).not.toHaveBeenCalled();
    expect(repository.failCandidate).toHaveBeenCalledWith(expect.objectContaining({ errorCode: "safety-gate" }));
  });

  it("does not call a provider when policy suppresses the message", async () => {
    const repository = repositoryFixture({
      getEligibilityState: vi.fn().mockResolvedValue(state({ proactiveCount24h: 3 })),
    });
    const provider = { generate: vi.fn() };
    const result = await generateLuciaProactiveMessage({ userId: "user-1", source: "quiet_presence", now, repository, provider });
    expect(result).toMatchObject({ status: "suppressed", reason: "daily-limit" });
    expect(repository.createCandidate).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
