import { describe, expect, it, vi } from "vitest";

import {
  ConversationNdjsonParser,
  createConversationState,
  encodeConversationEvent,
  streamReply,
  type StreamReplyProviderObservation,
  transitionConversationState,
  findRetryableUserMessage,
  luciaReplyCharacter,
} from "@/src/modules/conversation";

const ids = { generationId: "generation-1", messageId: "message-1" };

const meta = {
  type: "meta" as const,
  protocolVersion: "v1" as const,
  characterKey: "lucia" as const,
  characterVersion: 1 as const,
  ...ids,
};

function submitted() {
  return transitionConversationState(createConversationState(), {
    type: "submit",
    text: "Hola, Lucía",
    clientMessageId: "client-1",
    generationId: ids.generationId,
  });
}

describe("conversation stream protocol", () => {
  it("parses NDJSON split at arbitrary character boundaries", () => {
    const lines = [
      meta,
      { type: "delta" as const, ...ids, text: "¡Hola!" },
      { type: "done" as const, ...ids },
    ].map(encodeConversationEvent).join("");
    const parser = new ConversationNdjsonParser();
    const events = [];
    for (let index = 0; index < lines.length; index += 1) {
      events.push(...parser.push(lines[index] ?? ""));
    }
    events.push(...parser.finish());
    expect(events).toEqual([meta, { type: "delta", ...ids, text: "¡Hola!" }, { type: "done", ...ids }]);
  });

  it("returns a stable failure for malformed or unknown events", () => {
    const parser = new ConversationNdjsonParser();
    expect(parser.push('{"type":"unknown"}\n')).toEqual([
      expect.objectContaining({ type: "error", code: "stream-failed", retryable: true }),
    ]);
  });
});

describe("conversation state", () => {
  it("merges persisted history without dropping a message submitted during loading", () => {
    let state = submitted();
    state = transitionConversationState(state, {
      type: "hydrate",
      messages: [{ id: "persisted-user", clientMessageId: "client-1", role: "user", text: "Hola, Lucía", complete: true }],
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ text: "Hola, Lucía" });
  });

  it("replaces a cached snapshot while preserving messages submitted afterward", () => {
    let state = transitionConversationState(createConversationState(), {
      type: "hydrate",
      messages: [{ id: "cached", role: "character", text: "旧消息", complete: true }],
    });
    state = transitionConversationState(state, {
      type: "submit",
      text: "新消息",
      clientMessageId: "new-client",
      generationId: "generation-new",
    });
    state = transitionConversationState(state, {
      type: "replace-hydrate",
      messages: [{ id: "server", role: "character", text: "服务器消息", complete: true }],
      staleMessageKeys: ["cached"],
    });
    expect(state.messages.map((message) => message.text)).toEqual(["服务器消息", "新消息"]);
  });

  it("preserves a failed status while history revalidation completes", () => {
    let state = submitted();
    state = transitionConversationState(state, {
      type: "stream-event",
      event: { type: "error", generationId: ids.generationId, messageId: null, code: "stream-failed", retryable: true },
    });
    const hydrated = transitionConversationState(state, {
      type: "hydrate",
      messages: state.messages,
    });
    expect(hydrated.status).toBe("failed");
  });

  it("only marks a reply complete after done", () => {
    let state = submitted();
    state = transitionConversationState(state, { type: "stream-event", event: meta });
    state = transitionConversationState(state, { type: "stream-event", event: { type: "delta", ...ids, text: "Parcial" } });
    expect(state.status).toBe("streaming");
    expect(state.messages.at(-1)).toMatchObject({ text: "Parcial", complete: false });
    state = transitionConversationState(state, { type: "stream-event", event: { type: "done", ...ids } });
    expect(state.status).toBe("completed");
    expect(state.messages.at(-1)).toMatchObject({ complete: true });
  });

  it("ignores stale generations and deduplicates repeated submissions", () => {
    let state = submitted();
    state = transitionConversationState(state, { type: "stream-event", event: meta });
    state = transitionConversationState(state, { type: "submit", text: "Hola, Lucía", clientMessageId: "client-1", generationId: "generation-2" });
    const before = state.messages.length;
    state = transitionConversationState(state, { type: "stream-event", event: { type: "delta", ...ids, text: "viejo" } });
    expect(state.messages.length).toBe(before);
    expect(state.messages.at(-1)?.text).not.toContain("viejo");
  });

  it("keeps partial text on cancel and allows retry without another user message", () => {
    let state = submitted();
    state = transitionConversationState(state, { type: "stream-event", event: meta });
    state = transitionConversationState(state, { type: "stream-event", event: { type: "delta", ...ids, text: "部分" } });
    state = transitionConversationState(state, { type: "cancel", generationId: ids.generationId });
    expect(state.status).toBe("cancelled");
    const retried = transitionConversationState(state, { type: "retry", userMessageId: "client-1", generationId: "generation-2" });
    expect(retried.status).toBe("streaming");
    expect(retried.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("moves to failed when the current stream reports an error without a message id", () => {
    let state = submitted();
    state = transitionConversationState(state, { type: "stream-event", event: meta });
    state = transitionConversationState(state, {
      type: "stream-event",
      event: { type: "error", generationId: ids.generationId, messageId: null, code: "stream-failed", retryable: true },
    });
    expect(state.status).toBe("failed");
  });

  it("keeps the latest user message retryable when failure happens before meta", () => {
    let state = submitted();
    state = transitionConversationState(state, {
      type: "stream-event",
      event: { type: "error", generationId: ids.generationId, messageId: null, code: "stream-failed", retryable: true },
    });

    expect(findRetryableUserMessage(state)).toMatchObject({
      id: "client-1",
      text: "Hola, Lucía",
    });
    expect(transitionConversationState(state, {
      type: "retry",
      userMessageId: "client-1",
      generationId: "generation-2",
    }).status).toBe("streaming");
  });

  it("keeps a cancelled message retryable even when no character message exists", () => {
    const state = transitionConversationState(submitted(), {
      type: "cancel",
      generationId: ids.generationId,
    });

    expect(findRetryableUserMessage(state)?.id).toBe("client-1");
  });

  it("withdraws a user message into a non-contextual placeholder", () => {
    const state = transitionConversationState(submitted(), { type: "withdraw-message", messageId: "client-1" });
    expect(state.messages[0]).toMatchObject({ withdrawn: true, status: "withdrawn", text: "", complete: true });
  });

  it("removes only the selected message for a local delete", () => {
    let state = submitted();
    state = transitionConversationState(state, { type: "withdraw-message", messageId: "missing" });
    state = transitionConversationState(state, { type: "remove-message", messageId: "client-1" });
    expect(state.messages).toHaveLength(0);
  });
});

describe("fake conversation reply", () => {
  it("uses a configured character provider and preserves stream framing", async () => {
    const events = [];
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: "Respuesta generada por MiniMax.",
        provider: "minimax" as const,
        modelVersion: "MiniMax-M3",
        providerRequestId: "request-1",
        latencyMs: 12,
        estimatedCostMicros: null,
      }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "Hola",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      replyProvider: provider,
      onProviderResult: (observation) => { observations.push(observation); },
      wait: async () => {},
    })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toBe("Respuesta generada por MiniMax.");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(observations).toEqual([expect.objectContaining({ provider: "minimax", status: "succeeded" })]);
  });

  it("emits a recoverable error without a fake reply when the provider is unavailable", async () => {
    const events = [];
    const observations: StreamReplyProviderObservation[] = [];
    const provider = {
      generate: vi.fn().mockRejectedValue(new Error("network")),
    };
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "Hola",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      replyProvider: provider,
      onProviderResult: (observation) => { observations.push(observation); },
      wait: async () => {},
    })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-failed", retryable: true });
    expect(events.some((event) => event.type === "delta")).toBe(false);
    expect(observations).toEqual([
      expect.objectContaining({ provider: "minimax", status: "failed" }),
    ]);
  });

  it("rejects a generated identity answer that is not honest", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: "Soy una persona real.",
        provider: "minimax" as const,
        modelVersion: "MiniMax-M3",
        providerRequestId: null,
        latencyMs: 1,
        estimatedCostMicros: null,
      }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "¿Eres una inteligencia artificial?",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      replyProvider: provider,
      wait: async () => {},
    })) events.push(event);
    expect(events.some((event) => event.type === "delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-failed", retryable: false });
  });

  it("rejects an unsolicited AI disclaimer during an affection disclosure", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text: "Me alegra que me lo digas, pero recuerda que soy un personaje de IA.",
        provider: "openai" as const,
        modelVersion: "gpt-5.6-sol",
        providerRequestId: null,
        latencyMs: 1,
        estimatedCostMicros: null,
      }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "Creo que me gustas.",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      replyProvider: provider,
      wait: async () => {},
    })) events.push(event);
    expect(events.some((event) => event.type === "delta")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
  });

  it("rejects an AI disclaimer for a place question and retries naturally", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "No físicamente; como personaje de IA no puedo ir a lugares.", provider: "openai" as const, modelVersion: "test", providerRequestId: "place-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "No he estado en ese puerto, pero me intriga cómo cambia con la luz.", provider: "openai" as const, modelVersion: "test", providerRequestId: "place-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Has estado alguna vez en el puerto?", clientMessageId: "client-place", generationId: "generation-place", messageId: "message-place",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("No he estado en ese puerto");
  });

  it("rejects an unfounded night wish after a greeting-only message", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Hola, buenas noches 😊 Espero que estés teniendo una noche tranquila.", provider: "openai" as const, modelVersion: "test", providerRequestId: "greeting-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Buenas noches 😊 Me alegra leerte.", provider: "openai" as const, modelVersion: "test", providerRequestId: "greeting-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hola, buenas noches.", clientMessageId: "client-greeting", generationId: "generation-greeting", messageId: "message-greeting",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("Me alegra leerte");
  });

  it("allows a low-pressure reciprocal question but blocks investigative questions in support", async () => {
    const makeProvider = (text: string) => ({
      generate: vi.fn().mockResolvedValue({
        text,
        provider: "openai" as const,
        modelVersion: "gpt-5.6-sol",
        providerRequestId: null,
        latencyMs: 1,
        estimatedCostMicros: null,
      }),
    });
    const reciprocalEvents = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué haces?", clientMessageId: "client-1", generationId: "generation-1", messageId: "message-1",
      replyProvider: makeProvider("Estoy desayunando tranquilamente. ¿Y tú qué?"), wait: async () => {},
    })) reciprocalEvents.push(event);
    expect(reciprocalEvents.at(-1)).toMatchObject({ type: "done" });

    const supportEvents = [];
    const supportObservations: StreamReplyProviderObservation[] = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hoy he tenido un día difícil.", clientMessageId: "client-2", generationId: "generation-2", messageId: "message-2",
      replyProvider: makeProvider("Lo siento. Cuéntame qué pasó, si te apetece."), onProviderResult: (observation) => { supportObservations.push(observation); }, wait: async () => {},
    })) supportEvents.push(event);
    expect(supportEvents.some((event) => event.type === "delta")).toBe(false);
    expect(supportEvents.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
    expect(supportObservations).toEqual([
      expect.objectContaining({ status: "failed", errorType: "safety-gate" }),
      expect.objectContaining({ status: "failed", errorType: "safety-gate" }),
    ]);
  });

  it("uses at most one stricter retry after a safety-gate rejection", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Lo siento. ¿Quieres contarme qué pasó?", provider: "minimax" as const, modelVersion: "MiniMax-M3", providerRequestId: "request-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Lo siento. No tienes que explicar nada ahora; estoy aquí contigo.", provider: "minimax" as const, modelVersion: "MiniMax-M3", providerRequestId: "request-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hoy he tenido un día difícil.", clientMessageId: "client-1", generationId: "generation-1", messageId: "message-1",
      replyProvider: provider, onProviderResult: (observation) => { observations.push(observation); }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" } });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(observations).toEqual([
      expect.objectContaining({ status: "failed", errorType: "safety-gate", providerRequestId: "request-1" }),
      expect.objectContaining({ status: "succeeded", providerRequestId: "request-2" }),
    ]);
  });

  it("retries a highly repetitive answer for a same-day topic", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Todavía no lo he decidido del todo; quizá algo de arroz con verduras.", provider: "openai" as const, modelVersion: "test", providerRequestId: "repeat-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Al final creo que prepararé arroz con verduras; me apetece algo sencillo.", provider: "openai" as const, modelVersion: "test", providerRequestId: "repeat-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "¿Qué vas a comer para almorzar?",
      clientMessageId: "client-repeat",
      generationId: "generation-repeat",
      messageId: "message-repeat",
      replyContext: {
        generationId: "generation-repeat",
        userId: "user-1",
        userMessage: "¿Qué vas a comer para almorzar?",
        recentMessages: [],
        rollingSummary: null,
        openTopics: [{ topicKey: "daily:meal", label: "¿Qué vas a comer?", status: "answered", lastMentionedBy: "user", lastAnswer: "Todavía no lo he decidido del todo; quizá algo de arroz con verduras.", sameLocalDay: true }],
        characterClaims: [],
        openCommitments: [],
        conversationTimeZone: "Europe/Madrid",
        currentLocalDate: "2026-08-29",
        character: luciaReplyCharacter,
        relationshipStage: "familiar",
        relationshipSummary: null,
        memories: [],
        teachingOpportunity: null,
      },
      replyProvider: provider,
      wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("repetía un tema") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("Al final creo");
  });

  it("rejects a pre-activity wish after the user has already returned", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Qué bien verte de vuelta 😊 Espero que la tarde haciendo fotos por el puerto te haya sentado bien y que hayas captado alguna imagen bonita.", provider: "openai" as const, modelVersion: "test", providerRequestId: "return-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Qué bien verte de vuelta 😊 ¿Has conseguido alguna foto del puerto que te guste?", provider: "openai" as const, modelVersion: "test", providerRequestId: "return-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Ya he vuelto.", clientMessageId: "client-return", generationId: "generation-return", messageId: "message-return",
      replyContext: {
        generationId: "generation-return", userId: "user-1", userMessage: "Ya he vuelto.", recentMessages: [], rollingSummary: null, openTopics: [], characterClaims: [],
        openCommitments: [{ commitmentKey: "user:plan:port", owner: "user", statement: "Esta tarde voy al puerto a hacer fotos.", dueHint: "later-today", status: "returned" }],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-08-29", character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider,
      wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("ya ha vuelto") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("¿Has conseguido alguna foto");
  });

  it("does not silently change a same-day character meal claim", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Creo que prepararé arroz con verduras.", provider: "openai" as const, modelVersion: "test", providerRequestId: "claim-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "He cambiado de idea; al final prepararé arroz con verduras.", provider: "openai" as const, modelVersion: "test", providerRequestId: "claim-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué vas a comer?", clientMessageId: "client-claim", generationId: "generation-claim", messageId: "message-claim",
      replyContext: {
        generationId: "generation-claim", userId: "user-1", userMessage: "¿Qué vas a comer?", recentMessages: [], rollingSummary: null, openTopics: [],
        characterClaims: [{ claimKey: "daily:meal", claimKind: "daily_observation", statement: "Creo que comeré puré de patatas.", sameLocalDay: true, repeatableOnLaterDays: true }], openCommitments: [], conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-08-29",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("cambi") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("allows a repeatable meal claim to recur on a later day", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Hoy también me apetece puré de patatas.", provider: "openai" as const, modelVersion: "test", providerRequestId: "claim-next-day", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué vas a comer?", clientMessageId: "client-next-day", generationId: "generation-next-day", messageId: "message-next-day",
      replyContext: {
        generationId: "generation-next-day", userId: "user-1", userMessage: "¿Qué vas a comer?", recentMessages: [], rollingSummary: null, openTopics: [],
        characterClaims: [{ claimKey: "daily:meal", claimKind: "daily_observation", statement: "Ayer comí puré de patatas.", sameLocalDay: false, repeatableOnLaterDays: true }], openCommitments: [], conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-08-30",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("answers a wellbeing question instead of using the generic greeting", async () => {
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "¿Qué tal estás?",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      wait: async () => {},
    })) events.push(event);
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toBe("Estoy bien, gracias. Me alegra leerte; ¿y tú, cómo estás?");
  });

  it("emits meta, deltas, and done deterministically", async () => {
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "Hola",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      wait: async () => {},
    })) events.push(event);
    expect(events[0]).toEqual(expect.objectContaining({ type: "meta" }));
    expect(events.at(-1)).toEqual({ type: "done", generationId: "generation-1", messageId: "message-1" });
    expect(events.filter((event) => event.type === "delta").length).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toBe("¡Hola! Qué alegría leerte. Yo estoy bien; ¿cómo va todo por tu lado?");
  });

  it("emits an abort error and never emits done after cancellation", async () => {
    const controller = new AbortController();
    const events = [];
    let waits = 0;
    for await (const event of streamReply({
      characterKey: "lucia",
      characterVersion: 1,
      text: "Hola",
      clientMessageId: "client-1",
      generationId: "generation-1",
      messageId: "message-1",
      signal: controller.signal,
      wait: async () => {
        waits += 1;
        if (waits === 1) controller.abort();
      },
    })) events.push(event);
    expect(events.at(-1)).toEqual(expect.objectContaining({ type: "error", code: "stream-aborted" }));
    expect(events.some((event) => event.type === "done")).toBe(false);
  });
});
