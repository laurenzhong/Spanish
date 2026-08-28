import { describe, expect, it, vi } from "vitest";

import {
  ConversationNdjsonParser,
  createConversationState,
  encodeConversationEvent,
  streamReply,
  type StreamReplyProviderObservation,
  transitionConversationState,
  findRetryableUserMessage,
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
