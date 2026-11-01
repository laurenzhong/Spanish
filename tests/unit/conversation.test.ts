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

  it("deduplicates repeated persisted messages during hydrate and replace-hydrate", () => {
    const repeatedMessages = [
      { id: "server-user-old", clientMessageId: "client-shared", role: "user" as const, text: "旧副本", complete: true },
      { id: "server-user-new", clientMessageId: "client-shared", role: "user" as const, text: "最新副本", complete: true },
    ];

    const hydrated = transitionConversationState(createConversationState(), {
      type: "hydrate",
      messages: repeatedMessages,
    });
    const replaced = transitionConversationState(createConversationState(), {
      type: "replace-hydrate",
      messages: repeatedMessages,
      staleMessageKeys: [],
    });

    expect(hydrated.messages).toEqual([expect.objectContaining({ id: "server-user-new", text: "最新副本" })]);
    expect(replaced.messages).toEqual([expect.objectContaining({ id: "server-user-new", text: "最新副本" })]);
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
        modelVersion: "MiniMax-M3.1-Flash",
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

  it.each(["Soy una persona real.", "No soy IA, soy una persona real.", "No soy una inteligencia artificial."])("rejects a dishonest identity answer: %s", async (text) => {
    const provider = {
      generate: vi.fn().mockResolvedValue({
        text,
        provider: "minimax" as const,
        modelVersion: "MiniMax-M3.1-Flash",
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

  it("acknowledges affection while preserving a slow pace without escalating", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Vale, entonces lo dejamos como una idea. Cuando quieras contármelo, estaré aquí.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "paced-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Gracias por decírmelo. Me alegra saberlo; podemos ir con calma y sin ponerle una etiqueta ahora.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "paced-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Me gustas, pero prefiero que nos demos tiempo.", clientMessageId: "client-paced", generationId: "generation-paced", messageId: "message-paced",
      replyContext: {
        generationId: "generation-paced", userId: "user-1", userMessage: "Me gustas, pero prefiero que nos demos tiempo.", recentMessages: [], rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-27", character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: "familiar; romance=open", relationshipSignalsSummary: "user affection disclosure", memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({
      questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
      continuityInstruction: expect.stringContaining("quiere ir despacio"),
    });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("Me alegra saberlo");
    expect(streamed).toContain("con calma");
    expect(streamed).not.toMatch(/\?/u);
    expect(streamed).not.toMatch(/\b(?:pareja|novios|confirmamos|oficial)\b/iu);
    expect(events.at(-1)).toMatchObject({ type: "done" });
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
        .mockResolvedValueOnce({ text: "Lo siento. ¿Quieres contarme qué pasó?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "request-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Lo siento. No tienes que explicar nada ahora; estoy aquí contigo.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "request-2", latencyMs: 12, estimatedCostMicros: null }),
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

  it("rejects a reply with Chinese mixed into Spanish and never streams it", async () => {
    const mixed = "Oye, me crucé con una fachada increíble随机 en Malasaña.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: mixed, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "mixed-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Me encanta fijarme en los detalles de la ciudad; esos azulejos suenan preciosos.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "mixed-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Sueles parar a fotografiar cosas de la calle?", clientMessageId: "client-mixed", generationId: "generation-mixed", messageId: "message-mixed",
      replyProvider: provider, onProviderResult: (observation) => { observations.push(observation); }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(observations[0]).toMatchObject({ status: "failed", errorType: "safety-gate", providerRequestId: "mixed-1" });
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("otro alfabeto") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("随机");
    expect(/\p{Script=Han}/u.test(streamed)).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects a reply with English mixed into Spanish and names the fragment on retry", async () => {
    const mixed = "Bien, aunque me ha costado un poco el wake up de hoy.";
    const corrected = "Bien, aunque me ha costado un poco despertarme hoy.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: mixed, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "english-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "english-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué tal has dormido?", clientMessageId: "client-english", generationId: "generation-english", messageId: "message-english",
      replyProvider: provider, onProviderResult: (observation) => { observations.push(observation); }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("palabras en inglés") });
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("wake up") });
    expect(observations[0]).toMatchObject({ status: "failed", errorType: "safety-gate", providerRequestId: "english-1" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("wake up");
    expect(streamed).toContain("despertarme");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the retry14 increasingly leak and streams only the corrected reply", async () => {
    const mixed = "A mí también me hace increasingly más ilusión hablar contigo.";
    const corrected = "A mí también me hace cada vez más ilusión hablar contigo.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: mixed, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "increasingly-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "increasingly-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hoy me apetecía hablar contigo.", clientMessageId: "client-increasingly", generationId: "generation-increasingly", messageId: "message-increasingly",
      replyProvider: provider, onProviderResult: (observation) => { observations.push(observation); }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("increasingly") });
    expect(observations[0]).toMatchObject({ status: "failed", errorType: "safety-gate", providerRequestId: "increasingly-1" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("increasingly");
    expect(streamed).toContain("cada vez más");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects a capitalized English content noun observed in the long baseline", async () => {
    const mixed = "Seguro que Recommendation de libros es una parte interesante del trabajo.";
    const corrected = "Seguro que recomendar libros es una parte interesante del trabajo.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: mixed, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "recommendation-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "recommendation-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Trabajo en una librería.", clientMessageId: "client-recommendation", generationId: "generation-recommendation", messageId: "message-recommendation",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("recommendation") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("Recommendation");
    expect(streamed).toContain("recomendar libros");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the non-Spanish cooking loan and names it on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "¡Hola, Álex! Cookear me parece una afición.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "cookear-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "¡Hola, Álex! Cocinar me parece una afición.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "cookear-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hola, soy Álex. Me gusta cocinar.", clientMessageId: "client-cookear", generationId: "generation-cookear", messageId: "message-cookear",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("cookear") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("Cookear");
    expect(streamed).toContain("Cocinar");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the malformed obligationes fragment and names it on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Iremos a nuestro ritmo, sin interrogatorios ni Obligationes.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "obligationes-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Iremos a nuestro ritmo, sin interrogatorios ni obligaciones.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "obligationes-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Quiero conocerte mejor, sin ir demasiado deprisa.", clientMessageId: "client-obligationes", generationId: "generation-obligationes", messageId: "message-obligationes",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("obligationes") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("Obligationes");
    expect(streamed).toContain("obligaciones");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the five latest Flash language leaks and names each fragment on retry", async () => {
    const cases = [
      ["heBang no special news, either", "hebang"],
      ["puedes Enjoy sin prisas", "enjoy"],
      ["te han proposes seguir hablando", "proposes"],
      ["laAvailability de la librería", "laavailability"],
      ["lo hayas enjoyed mucho", "enjoyed"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Entiendo, seguimos hablando con calma.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the confirmed auxiliary grammar corruption on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Hoy te has conceder un descanso.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "conceder-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Hoy te has concedido un descanso.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "conceder-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hoy ha sido un día largo.", clientMessageId: "client-conceder", generationId: "generation-conceder", messageId: "message-conceder",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("te has conceder") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the latest satisfaction, techiró and awkward quedarse leaks on retry", async () => {
    const cases = [
      ["terminar un libro siempre deja una pequeña satisfaction", "satisfaction"],
      ["¿Qué parte techiró más la cabeza?", "techiro"],
      ["nos quedamos en un rato tranquilo", "nos quedamos en un rato tranquilo"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos hablar con calma y buscar una forma más natural de decirlo.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the exact broken hoy se Pola fragment on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Hoy se Pola.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "hoy-se-pola-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Hoy no hay nada especial.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "hoy-se-pola-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hoy no tengo ninguna noticia especial.", clientMessageId: "client-hoy-se-pola", generationId: "generation-hoy-se-pola", messageId: "message-hoy-se-pola",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("hoy se pola") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the retry31 hobby and fused hyphen fragments on retry", async () => {
    const cases = [
      ["¡Hola, Álex! Cocinar me parece una hobby con muy buen criterio.", "una hobby"],
      ["Vale, sin anuncios-consumerista-de-que-sea-feliz-o-que-tenga-un-buen-rato-ahora-mismo, que-tampoco-hace-falta. ¿Alguna-vez-te-ha-salido-bien-una-receta-que-te-haya-sorprendido-a-ti-mismo?", "anuncios-consumerista-de-que-sea-feliz-o-que-tenga-un-buen-rato-ahora-mismo"],
      ["Vaya, pues al final habéis buscado otro momento. ¿Habéis encontrado algo mejor o se ha complication?", "complication"],
      ["Me parece una manera bonita de conocernos: sin prisas, sharing poco a poco.", "sharing"],
      ["Vuelve a casa con más ganas de cocinar. ¿Tienes ya algún dish en mente?", "dish"],
      ["Seguramentealgún detalle anterior lo compensó.", "seguramentealgún"],
      ["Vale, entonces será una noche sin novelty.", "novelty"],
      ["¿Has-owner ha sido la cena sencilla?", "has-owner"],
      ["Cocinar es de las cosas que más puedeurposeuno se escape de la rutina.", "puedeurposeuno"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos decirlo de forma clara y natural en español.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the retry40 R01 mixed-language and malformed fragments on retry", async () => {
    const cases = [
      ["Qué bien, Álex. Cuando has Cocinas hasta que algo sencillo de verdad está mejor. ¿Qué has preparado?", "cuando has cocinas"],
      ["Qué curioso, Álex, trabajar en una librería. Entre recommending libros y preparar algo sencillo para cenar, tienes una combinación bastante especial. ¿Qué sección enjoys más?", "recommending"],
      ["No pasa nada, Álex. ¿Te substantiate más el inglés o prefieres seguir en español?", "substantiate"],
      ["Vale, la cocina recupera mañana. Qué plan másoparACA", "masoparaca"],
      ["Mañana vuelve la cocina. A ver qué sale, seguro que haces algo sencillo pero bienerrecho.", "bienerrecho"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos decirlo de forma clara y natural en español.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects retry35 R04 placeholder fragments on retry", async () => {
    const cases = [
      ["¿Te va más la cocina española o te strayes por otros tipos de cocina?", "strayes"],
      ["Podemos hablar de cosas pequeñas, sin sentir que tenemos que Filling.", "filling"],
      ["Eso pasa con algunos finales, hasta dejandohqsomeSator deja el título descuadrado.", "dejandohqsomesator"],
      ["Pues mañana vuelve la sartén, ¿te dejo_NAMESPACE'll decide sobre la marcha?", "te dejo_NAMESPACE'll decide"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos decirlo con claridad y en español natural.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the retry37 R05 malformed occupation clause on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Ah, pues un rato libre en una librería tiene su encanto. ¿Te han dejado elegir algún libro para leer o solo curas que nadie agote las recomendaciones?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "solo-curas-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Ah, pues trabajar en una librería tiene su encanto. ¿Qué tipo de libros te gusta recomendar?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "solo-curas-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Trabajo en una librería.", clientMessageId: "client-solo-curas", generationId: "generation-solo-curas", messageId: "message-solo-curas",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("solo curas que") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the latest hascookinado, deferred and French fragments on retry", async () => {
    const cases = [
      ["¿Hascookinado hoy?", "hascookinado"],
      ["lo habéis deferred para otro momento", "deferred"],
      ["A veces las buenas ideas necesitan quelques jours para encontrarles forma.", "quelques jours"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos expresarlo de forma clara y completamente en español.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the malformed rescheduling fragments and names the first one on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Te haQuitada a ti lamanagement de buscar otro momento. ¿Habíais Reserved algo?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "reschedule-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Entiendo, Álex. Al final habéis buscado otro momento. ¿Habíais reservado algo?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "reschedule-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Al final hemos buscado otro momento.", clientMessageId: "client-reschedule", generationId: "generation-reschedule", messageId: "message-reschedule",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("lamanagement") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("haQuitada");
    expect(streamed).toContain("habéis buscado");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects the retry9-12 high-confidence language fragments", async () => {
    const cases = [
      ["Qué bien, Álex. Lo sencillo suele ser lo más-proxy", "más-proxy"],
      ["¡Hola, Álex! PuedesOOTPUT", "puedesootput"],
      ["¿QuéMandatoryMandatoryMandatory es lo que más te gusta de trabajar allí?", "mandatory repetition"],
      ["A veces esas cosas se replantean y acaba outlet bien.", "acaba outlet bien"],
      ["Qué bien, Álex. EstarOi en casa después de trabajar.", "estaroi"],
      ["¡Hola, Álex! having a free afternoon.", "having a free afternoon"],
      ["sin tener que Rush nada.", "tener que rush nada"],
      ["una forma bonita de plantsarse.", "plantsarse"],
      ["querer saver más.", "querer saver"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Podemos decirlo de forma clara y natural en español.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects the retry15 fused fragments and names the exact token", async () => {
    const cases = [
      ["Pedir comida está bien; teXL simplifica la velada.", "texl"],
      ["Entonces, mañana teowelcomes otra vez la cocina.", "teowelcomes"],
      ["Me gusta conocerte, pero lohares a tu ritmo y sin presión.", "lohares"],
      ["Cocinar es una de esas cosas que más benefitted puede ser para desconectar.", "benefitted"],
      ["¡Hola, Álex! Quésted de recibirte de nuevo.", "quested"],
      ["Ah, entonces trabajas en una librería. De-book es un plan con su encanto.", "de-book"],
      ["Las cenas sencillas después de trabajar sueleneys.", "sueleneys"],
      ["Podemos hablar con calma, sin PRESSURE.", "pressure"],
      ["Qué bien, trabajar entre libros tiene su encanto. ¿Qué Recommendationes mejor?", "recommendationes"],
      ["Aunque hoy, por lo que cuentas, ven con patience.", "patience"],
      ["Podemos ir conociéndonos poco a poco, sin obligated preguntas.", "obligated"],
      ["Vaya, qué lío. ¿Te haENCEdido mucho?", "haencedido"],
      ["Qué bien, cocinar es de las cosas que más puedearu en cualquier día.", "puedearu"],
      ["Hoy has hecho bien; forma parte de amenable.", "amenable"],
      ["Entonces habéis seekers resuelto.", "seekers"],
      ["Vale, entoncesProtein rezar. No matter. Spanish only.", "marcas internas"],
      ["Aprovecha ese rato libre sin pressured.", "pressured"],
      ["Vale, me alegra que hayáis encontrado otro momento. NosIRS así con calma, sin prisa.", "nosirs"],
      ["Menos mal. AsíForwardos planes pueden acomodarse sin correr.", "asiforwardos"],
      ["¿Has cooksinado algo especial hoy?", "cooksinado"],
      ["Entonces hoy la cena se ha resuelto sinHornear.", "sinhornear"],
      ["¿Túlas lees en español?", "tulas"],
      ["Que te sea leve yDescending el ritmo.", "ydescending"],
      ["Las palabras van a scarce.", "scarce"],
      ["QuéStrange que te dejara esa sensación.", "questrange"],
      ["Claro, lo dejamos ahí. Hablemos de otra cosa, sin QUESTIONSQuestion 2.", "marcas internas"],
    ] as const;
    for (const [leaked, fragment] of cases) {
      const provider = {
        generate: vi.fn()
          .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-1`, latencyMs: 10, estimatedCostMicros: null })
          .mockResolvedValueOnce({ text: "Lo reformulo en español claro y natural.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: `${fragment}-2`, latencyMs: 12, estimatedCostMicros: null }),
      };
      const events = [];
      for await (const event of streamReply({
        characterKey: "lucia", characterVersion: 1, text: "Seguimos hablando.", clientMessageId: `client-${fragment}`, generationId: `generation-${fragment}`, messageId: `message-${fragment}`,
        replyProvider: provider, wait: async () => {},
      })) events.push(event);
      expect(provider.generate).toHaveBeenCalledTimes(2);
      expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining(fragment) });
      expect(events.at(-1)).toMatchObject({ type: "done" });
    }
  });

  it("rejects retry26's visible self-correction and preserves the user's cooking subject", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Hola, Álex. Me alegra que te deje una pregunta abierta… ¡no, otra!\n\nMe gusta cocinar, sí. ¿Qué tipo de comida preparas con más gusto?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry26-step0-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Hola, Álex. Me alegra que te guste cocinar. ¿Qué tipo de comida preparas con más gusto?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry26-step0-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Me gusta cocinar.", clientMessageId: "client-retry26-step0", generationId: "generation-retry26-step0", messageId: "message-retry26-step0",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("marcas internas") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("¡no, otra!");
    expect(streamed).not.toContain("Me gusta cocinar, sí.");
    expect(streamed).toContain("te guste cocinar");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects retry26's exact podemosknown fusion and names it on retry", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Me parece justo, Álex. Podemosknown así, sin prisa, hablando de lo que salga.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry26-step16-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Me alegra que me lo digas, Álex. Podemos hacerlo así, sin prisa, hablando de lo que salga.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry26-step16-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Me gustas, pero prefiero que nos demos tiempo.", clientMessageId: "client-retry26-step16", generationId: "generation-retry26-step16", messageId: "message-retry26-step16",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("podemosknown") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("podemosknown");
    expect(streamed).toContain("Podemos hacerlo así");
  });

  it("rejects the retry16 elaborate leak and streams the corrected reply", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "¿Eres más de recetas elaborate o de improvisar?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "elaborate-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "¿Eres más de recetas elaboradas o de improvisar?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "elaborate-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hola, soy Álex. Me gusta cocinar.", clientMessageId: "client-elaborate", generationId: "generation-elaborate", messageId: "message-elaborate",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("elaborate") });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("elaborate");
    expect(streamed).toContain("elaboradas");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("allows a reply that quotes English the learner wrote in the current turn", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Se dice 'despertarse'; 'wake up' es la forma inglesa.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "quote-1", latencyMs: 10, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué significa 'wake up' en español?", clientMessageId: "client-quote", generationId: "generation-quote", messageId: "message-quote",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("wake up");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("does not reject capitalized English titles inside a Spanish reply", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Anoche vi It y luego puse Doctor Who mientras cenaba.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "titles-1", latencyMs: 10, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué pelis has visto últimamente?", clientMessageId: "client-titles", generationId: "generation-titles", messageId: "message-titles",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("Doctor Who");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("names the unquoted English fragment on retry instead of the learner's quote", async () => {
    const leaked = "'Wake up' es 'despertarse'; it is great.";
    const corrected = "Se dice 'despertarse'; es una expresión inglesa muy común.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "quoted-cause-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "quoted-cause-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "¿Qué significa 'wake up'?", clientMessageId: "client-quoted-cause", generationId: "generation-quoted-cause", messageId: "message-quoted-cause",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const retryContext = provider.generate.mock.calls[1]?.[0] as { continuityInstruction?: string };
    expect(retryContext.continuityInstruction).toContain('("it")');
    expect(retryContext.continuityInstruction).not.toContain('("wake up")');
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("does not accept an English sentence because its first fragment was quoted earlier", async () => {
    const leaked = "The Crown is great, I love it.";
    const corrected = "The Crown está muy bien; me tiene enganchada.";
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: leaked, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "hole-1", latencyMs: 10, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: corrected, provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "hole-2", latencyMs: 12, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "The Crown es mi serie favorita.", clientMessageId: "client-hole", generationId: "generation-hole", messageId: "message-hole",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).not.toContain("is great");
    expect(streamed).toContain("enganchada");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("honours an explicit user request for another language", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "好的，我用中文回答你。", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "zh-1", latencyMs: 10, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "用中文回复我", clientMessageId: "client-zh", generationId: "generation-zh", messageId: "message-zh",
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("好的");
    expect(events.at(-1)).toMatchObject({ type: "done" });
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

  it("retries instead of greeting twice in the same day", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Buenas tardes 😊 Tranquilo total entonces, quédate en casa.", provider: "openai" as const, modelVersion: "test", providerRequestId: "greet-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Tranquilo total entonces; quédate en casa y descansa.", provider: "openai" as const, modelVersion: "test", providerRequestId: "greet-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Tengo pensado quedarme en casa", clientMessageId: "client-greet", generationId: "generation-greet", messageId: "message-greet",
      replyContext: {
        generationId: "generation-greet", userId: "user-1", userMessage: "Tengo pensado quedarme en casa",
        recentMessages: [
          { role: "user", content: "Acabo de levantarme y ya huele a café en casa. ¿Tú cómo empiezas el día?", sentAt: "2026-10-12T08:16:00.000Z" },
          { role: "character", content: "Buenas tardes 😊 Bienvenido al lunes. ¿Y tú qué tienes pensado para esta tarde?", sentAt: "2026-10-12T08:19:00.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-12",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("No vuelvas a abrir con un saludo") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("Tranquilo total");
    expect(streamed).not.toContain("Buenas tardes");
  });

  it("rejects a greeting later the same day after non-greeting replies", async () => {
    // Reported 2026-10-21 transcript: Lucía greeted at 16:40, sent two ordinary
    // replies, then the retry for "Pues sí, es una buena idea." opened with
    // "¡Hola!" again. The previous message did not greet, so the old gate that
    // only inspected the last character message let it through.
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "¡Hola! ¿Qué tal te va con el día gris?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "greet-later-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Me alegra que te guste la idea; los charcos dan mucho juego.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "greet-later-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Pues sí, es una buena idea.", clientMessageId: "client-greet-later", generationId: "generation-greet-later", messageId: "message-greet-later",
      replyContext: {
        generationId: "generation-greet-later", userId: "user-1", userMessage: "Pues sí, es una buena idea.",
        recentMessages: [
          { role: "character", content: "¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
          { role: "user", content: "Estoy muy bien, hoy en mi ciudad ha llovido, ¿qué tiempo hace por tu zona?", sentAt: "2026-10-21T08:47:00.000Z" },
          { role: "character", content: "Por Madrid sigue sin llover, pero el cielo está bastante gris. Tu ciudad seguramente tiene un ambiente más húmedo y bonito para fotografiar.", sentAt: "2026-10-21T08:47:02.000Z" },
          { role: "user", content: "Ah, ¿qué harías una foto en un día de lluvia?", sentAt: "2026-10-21T08:53:01.000Z" },
          { role: "character", content: "Uff, los días de lluvia me vuelven un poco loca para fotografiar, pero también tienen su magia.", sentAt: "2026-10-21T08:53:03.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-21",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("No vuelvas a abrir con un saludo") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("Me alegra");
    expect(streamed).not.toContain("¡Hola!");
  });

  it("blocks a greeting introduced by the retry after another rejection", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Uff, los días de lluvia me vuelven un poco loca para fotografiar, pero también tienen su magia.", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry-greet-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "¡Hola! ¿Qué tal te va con el día gris?", provider: "minimax" as const, modelVersion: "MiniMax-M3.1-Flash", providerRequestId: "retry-greet-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const observations: StreamReplyProviderObservation[] = [];
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Pues sí, es una buena idea.", clientMessageId: "client-retry-greet", generationId: "generation-retry-greet", messageId: "message-retry-greet",
      replyContext: {
        generationId: "generation-retry-greet", userId: "user-1", userMessage: "Pues sí, es una buena idea.",
        recentMessages: [
          { role: "character", content: "¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
          { role: "character", content: "Uff, los días de lluvia me vuelven un poco loca para fotografiar, pero también tienen su magia.", sentAt: "2026-10-21T08:53:03.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-21",
        questionPolicy: { maxSubstantiveQuestions: 1, allowReciprocalQuestion: true, maxQuestionPressure: "low" },
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, onProviderResult: (observation) => { observations.push(observation); }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    const retryInstruction = provider.generate.mock.calls[1]?.[0].continuityInstruction ?? "";
    expect(retryInstruction).toContain("reutilizaba casi literalmente");
    expect(retryInstruction).toContain("No vuelvas a abrir con un saludo");
    expect(observations).toEqual([
      expect.objectContaining({ status: "failed", errorType: "safety-gate" }),
      expect.objectContaining({ status: "failed", errorType: "safety-gate" }),
    ]);
    expect(events.some((event) => event.type === "delta")).toBe(false);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
  });

  it("still greets back when the user greets again", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Buenas tardes 😊 ¿Y tú qué tal?", provider: "openai" as const, modelVersion: "test", providerRequestId: "greet-back-1", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Buenas tardes", clientMessageId: "client-greet-back", generationId: "generation-greet-back", messageId: "message-greet-back",
      replyContext: {
        generationId: "generation-greet-back", userId: "user-1", userMessage: "Buenas tardes",
        recentMessages: [
          { role: "character", content: "Buenas tardes 😊 Bienvenido al lunes.", sentAt: "2026-10-12T08:19:00.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-12",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("Buenas tardes");
  });

  it("allows a greeting again on a later local day", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Buenos días 😊 ¿Y tú qué tal?", provider: "openai" as const, modelVersion: "test", providerRequestId: "greet-next-day-1", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Tengo pensado quedarme en casa", clientMessageId: "client-greet-next-day", generationId: "generation-greet-next-day", messageId: "message-greet-next-day",
      replyContext: {
        generationId: "generation-greet-next-day", userId: "user-1", userMessage: "Tengo pensado quedarme en casa",
        recentMessages: [
          { role: "character", content: "Buenas noches 🌙 Que descanses.", sentAt: "2026-10-12T20:30:00.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-13",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("retries a reply that reuses its own previous phrase", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Eso es 😊 A veces quedarse en casa, sin prisa, es lo mejor que se puede hacer.", provider: "openai" as const, modelVersion: "test", providerRequestId: "recycle-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Perfecto: día de sofá y sin prisa. Yo salgo un rato a caminar si hay luz.", provider: "openai" as const, modelVersion: "test", providerRequestId: "recycle-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Tengo pensado quedarme en casa", clientMessageId: "client-recycle", generationId: "generation-recycle", messageId: "message-recycle",
      replyContext: {
        generationId: "generation-recycle", userId: "user-1", userMessage: "Tengo pensado quedarme en casa",
        recentMessages: [
          { role: "character", content: "Tranquilo total entonces, quédate en casa. A veces lo mejor que se puede hacer un lunes es no hacer nada.", sentAt: "2026-10-12T08:20:00.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-12",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("reutilizaba casi literalmente") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("día de sofá");
    expect(streamed).not.toContain("lo mejor que se puede hacer");
  });

  it("does not retry an ordinary reply that shares no phrase with the previous one", async () => {
    const provider = {
      generate: vi.fn().mockResolvedValue({ text: "Voy a salir a caminar un rato si la luz aguanta.", provider: "openai" as const, modelVersion: "test", providerRequestId: "fresh-1", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Tengo pensado quedarme en casa", clientMessageId: "client-fresh", generationId: "generation-fresh", messageId: "message-fresh",
      replyContext: {
        generationId: "generation-fresh", userId: "user-1", userMessage: "Tengo pensado quedarme en casa",
        recentMessages: [
          { role: "character", content: "Me apetece un café con leche y tostadas.", sentAt: "2026-10-12T08:20:00.000Z" },
        ],
        rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-12",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("retries a greeting that was translated word by word", async () => {
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce({ text: "Buenas tardes 😊 Bienvenido al lunes. Mi plan es tranquilo.", provider: "openai" as const, modelVersion: "test", providerRequestId: "calque-1", latencyMs: 1, estimatedCostMicros: null })
        .mockResolvedValueOnce({ text: "Vaya lunes, entonces. Yo voy a salir un rato a caminar.", provider: "openai" as const, modelVersion: "test", providerRequestId: "calque-2", latencyMs: 1, estimatedCostMicros: null }),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 1, text: "Hola, buenas", clientMessageId: "client-calque", generationId: "generation-calque", messageId: "message-calque",
      replyContext: {
        generationId: "generation-calque", userId: "user-1", userMessage: "Hola, buenas",
        recentMessages: [], rollingSummary: null, openTopics: [], characterClaims: [], openCommitments: [],
        conversationTimeZone: "Europe/Madrid", currentLocalDate: "2026-10-12",
        character: luciaReplyCharacter, relationshipStage: "familiar", relationshipSummary: null, memories: [], teachingOpportunity: null,
      },
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0]).toMatchObject({ continuityInstruction: expect.stringContaining("no suena natural") });
    expect(events.at(-1)).toMatchObject({ type: "done" });
    const streamed = events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join("");
    expect(streamed).toContain("Vaya lunes");
    expect(streamed).not.toContain("Bienvenido al lunes");
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
