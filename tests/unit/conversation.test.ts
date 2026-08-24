import { describe, expect, it } from "vitest";

import {
  ConversationNdjsonParser,
  createConversationState,
  encodeConversationEvent,
  streamReply,
  transitionConversationState,
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
});

describe("fake conversation reply", () => {
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
