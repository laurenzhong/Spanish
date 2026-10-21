import { describe, expect, it } from "vitest";
import { conversationStreamRequestSchema } from "@/src/modules/conversation/schemas/conversation-stream-request";

const latest = { text: "He comprado un libro.", clientMessageId: "u2", generationId: "g2" };
describe("conversation batch request", () => {
  it("accepts legacy and bounded batches with visibility counts", () => {
    expect(conversationStreamRequestSchema.safeParse(latest).success).toBe(true);
    expect(conversationStreamRequestSchema.safeParse({ ...latest, pendingMessages: [{ text: "Me gusta la fotografía.", clientMessageId: "u1", assistance: "translation" }], supersedes: { generationId: "g1", visibleBubbleCount: 1 } }).success).toBe(true);
  });
  it("preserves the user's original text and enforces the raw length", () => {
    expect(conversationStreamRequestSchema.parse({ ...latest, text: "  Hola  " }).text).toBe("  Hola  ");
    expect(conversationStreamRequestSchema.safeParse({ ...latest, text: `${" ".repeat(2_000)}a` }).success).toBe(false);
  });
  it.each([
    { pendingMessages: Array.from({ length: 20 }, (_, index) => ({ text: "Hola", clientMessageId: `u${index}` })) },
    { pendingMessages: [{ text: " ", clientMessageId: "u1" }] },
    { pendingMessages: [{ text: "x".repeat(2001), clientMessageId: "u1" }] },
    { pendingMessages: [{ text: "Hola", clientMessageId: "u2" }] },
    { pendingMessages: [{ text: "Hola", clientMessageId: "u1", role: "character" }] },
    { pendingMessages: [{ text: "Hola", clientMessageId: "u1", assistance: "independent" }] },
    { supersedes: { generationId: "g2", visibleBubbleCount: 1 } },
    { supersedes: { generationId: "g1", visibleBubbleCount: -1 } },
    { supersedes: { generationId: "g1", visibleBubbleCount: 1.5 } },
    { supersedes: { generationId: "g1", visibleBubbleCount: 0, text: "injected" } },
  ])("rejects an invalid batch before persistence: %j", (extension) => {
    expect(conversationStreamRequestSchema.safeParse({ ...latest, ...extension }).success).toBe(false);
  });
});
