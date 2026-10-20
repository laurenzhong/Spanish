import { describe, expect, it } from "vitest";
import { createConversationState, transitionConversationState } from "@/src/modules/conversation/domain/conversation-state";

function prefix(text = "Una idea.\n\nOtra idea.") {
  let state = transitionConversationState(createConversationState(), { type: "submit", text: "Hola", clientMessageId: "u1", generationId: "g1" });
  state = transitionConversationState(state, { type: "stream-event", event: { type: "meta", protocolVersion: "v1", characterKey: "lucia", characterVersion: 3, generationId: "g1", messageId: "a1" } });
  if (text) state = transitionConversationState(state, { type: "stream-event", event: { type: "delta", generationId: "g1", messageId: "a1", text } });
  return state;
}

describe("conversation rhythm state", () => {
  it("recovers an idle interrupted view without replacing an active generation", () => {
    const action = { type: "recover-pending" as const, generationId: "saved-generation", messageId: "saved-message" };
    expect(transitionConversationState(createConversationState(), action)).toMatchObject({ status: "cancelled", activeGenerationId: "saved-generation", activeMessageId: "saved-message" });
    const active = prefix();
    expect(transitionConversationState(active, action)).toBe(active);
  });

  it("freezes a cancelled prefix against late delta, error and done", () => {
    const stopped = transitionConversationState(prefix(), { type: "cancel", generationId: "g1" });
    for (const event of [
      { type: "delta" as const, generationId: "g1", messageId: "a1", text: "Late" },
      { type: "done" as const, generationId: "g1", messageId: "a1" },
      { type: "error" as const, generationId: "g1", messageId: "a1", code: "stream-failed" as const, retryable: true },
    ]) expect(transitionConversationState(stopped, { type: "stream-event", event })).toEqual(stopped);
    expect(stopped.messages.at(-1)?.text).toBe("Una idea.\n\nOtra idea.");
  });

  it("removes an empty placeholder on cancel", () => {
    const stopped = transitionConversationState(prefix(""), { type: "cancel", generationId: "g1" });
    expect(stopped.messages.map((message) => message.id)).toEqual(["u1"]);
  });

  it.each(["hydrate", "replace-hydrate"] as const)("does not shrink locally visible prefixes during %s", (type) => {
    const state = prefix();
    const messages = [{ id: "a1", role: "character" as const, generationId: "g1", text: "Una idea.", complete: false }];
    const next = transitionConversationState(state, type === "replace-hydrate" ? { type, messages, staleMessageKeys: ["a1"] } : { type, messages });
    expect(next.messages.find((message) => message.id === "a1")?.text).toBe("Una idea.\n\nOtra idea.");
  });

  it.each(["hydrate", "replace-hydrate"] as const)("does not refill a server cancellation tombstone during %s", (type) => {
    const state = prefix();
    const messages = [{ id: "a1", role: "character" as const, generationId: "g1", text: "", complete: true, status: "cancelled" as const }];
    const next = transitionConversationState(state, type === "replace-hydrate" ? { type, messages, staleMessageKeys: ["a1"] } : { type, messages });
    expect(next.messages.find((message) => message.id === "a1")?.text).toBe("");
  });
});
