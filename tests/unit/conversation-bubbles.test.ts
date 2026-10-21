import { describe, expect, it, vi } from "vitest";
import { splitReplyBubbles } from "@/src/modules/conversation/domain/reply-bubbles";
import { streamReply } from "@/src/modules/conversation/application/stream-reply";
import { buildConversationSystemPrompt } from "@/src/modules/providers/conversation/conversation";
import { getConversationCharacter } from "@/src/modules/conversation/domain/character-catalog";
import { buildReplyContext } from "@/src/modules/conversation/application/build-reply-context";

const turn = (text: string, extra: Partial<Parameters<typeof streamReply>[0]> = {}) => streamReply({
  characterKey: "lucia", characterVersion: 3, text: "Me he comprado un libro.", clientMessageId: "c", generationId: "g", messageId: "m",
  replyProvider: { generate: vi.fn(async () => ({ text, provider: "minimax" as const, modelVersion: "fake", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null })) },
  wait: async () => {}, ...extra,
});
const collect = async (source: ReturnType<typeof streamReply>) => { const events = []; for await (const event of source) events.push(event); return events; };

describe("natural reply bubbles", () => {
  it("keeps one semantic paragraph intact even when long or containing single newlines", () => {
    const paragraph = "Me gusta fijarme en los detalles.\nHay mucho que descubrir. ".repeat(4).trim();
    expect(splitReplyBubbles(paragraph)).toEqual([paragraph]);
  });
  it("normalizes authored blank lines and never creates empty bubbles", () => {
    expect(splitReplyBubbles("  Uno.\r\n\r\n \r\nDos.\n\nTres.\n\n\nCuatro.  ")).toEqual(["Uno.", "Dos.", "Tres.", "Cuatro."]);
    expect(splitReplyBubbles(" \n\n ")).toEqual([]);
  });
  it.each([1, 2, 3, 4])("delivers %i full authored bubbles as one logical turn and one done", async (count) => {
    const bubbles = ["Qué bien.", "Los libros dan para mucho.", "Yo disfruto descubriendo detalles.", "¿De qué trata?"] .slice(0, count);
    const onBubble = vi.fn<NonNullable<Parameters<typeof streamReply>[0]["onBubble"]>>(async () => true);
    const wait = vi.fn<(milliseconds: number) => Promise<void>>(async () => {});
    const events = await collect(turn(bubbles.join("\n\n"), { onBubble, wait }));
    const deltas = events.filter(e => e.type === "delta");
    expect(deltas.map(e => e.text)).toEqual(bubbles.map((bubble, i) => `${i ? "\n\n" : ""}${bubble}`));
    expect(events.filter(e => e.type === "done")).toHaveLength(1);
    expect(deltas.every(e => e.generationId === "g" && e.messageId === "m")).toBe(true);
    expect(onBubble.mock.calls.map(([bubble]) => bubble.prefix)).toEqual(bubbles.map((_, i) => bubbles.slice(0, i + 1).join("\n\n")));
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([0, ...Array(count - 1).fill(450)]);
  });
  it("stops between bubbles without emitting a pending suffix or done", async () => {
    const controller = new AbortController();
    const events = await collect(turn("Me alegro.\n\n¿De qué trata?", { signal: controller.signal, wait: async ms => { if (ms) controller.abort(); } }));
    expect(events.filter(e => e.type === "delta").map(e => e.text)).toEqual(["Me alegro."]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-aborted" });
    expect(events.some(e => e.type === "done")).toBe(false);
  });
  it("does not emit a bubble that lost durable generation ownership", async () => {
    const events = await collect(turn("Me alegro.\n\n¿De qué trata?", { onBubble: async ({ index }) => index === 0 }));
    expect(events.filter(e => e.type === "delta").map(e => e.text)).toEqual(["Me alegro."]);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-aborted" });
    expect(events.some(e => e.type === "done")).toBe(false);
  });
  it("checks the entire turn before any bubble rather than permitting a dishonest later bubble", async () => {
    const onBubble = vi.fn(async () => true);
    const events = await collect(turn("Me alegro.\n\nSoy una persona real.", { onBubble }));
    expect(onBubble).not.toHaveBeenCalled();
    expect(events.some(e => e.type === "delta" || e.type === "done")).toBe(false);
  });
  it("gives the shared providers explicit brevity, semantic boundaries and tentative follow-up guidance", () => {
    const prompt = buildConversationSystemPrompt({ character: getConversationCharacter("lucia").snapshot });
    expect(prompt).toContain("Separate message bubbles with a blank line");
    expect(prompt).toContain("unanswered user messages together");
    expect(prompt).toContain("photography book");
    expect(prompt).toContain("not a confirmed fact");
  });
  it("preserves every unanswered submission independently of the recent history budget", async () => {
    const batch = Array.from({ length: 20 }, (_, i) => `${i}: ${"detalle ".repeat(200)}`);
    const context = await buildReplyContext({ generationId: "g", userId: "u", userMessage: batch[19]!, unansweredUserMessages: batch, recentMessageCharBudget: 100, recentMessages: batch.map(content => ({ role: "user", content })) });
    expect(context.unansweredUserMessages).toEqual(batch.map(message => message.trim()));
    expect(context.recentMessages).toHaveLength(1);
    expect(context.userMessage).toBe(batch[19]!.trim());
  });
  it("allows a truthful answer to an earlier unanswered AI question", async () => {
    const context = await buildReplyContext({ generationId: "g", userId: "u", userMessage: "También me gusta leer.", unansweredUserMessages: ["¿Eres una IA?", "También me gusta leer."] });
    const events = await collect(turn("Sí, soy un personaje de IA.\n\nA mí también me gusta leer.", { replyContext: context }));
    expect(events.at(-1)?.type).toBe("done");
  });
  it("retains an explicit language request from an earlier unanswered submission", async () => {
    const context = await buildReplyContext({ generationId: "g", userId: "u", userMessage: "Quiero entender esta palabra.", unansweredUserMessages: ["请用中文解释。", "Quiero entender esta palabra."] });
    const events = await collect(turn("这个词表示一种兴趣。", { replyContext: context }));
    expect(events.at(-1)?.type).toBe("done");
  });
  it("enforces the combined question budget across all bubbles", async () => {
    const context = await buildReplyContext({ generationId: "g", userId: "u", userMessage: "He comprado un libro.", unansweredUserMessages: ["Me gusta la fotografía.", "He comprado un libro."] });
    const events = await collect(turn("¿Qué fotografías?\n\n¿De qué trata el libro?", { replyContext: context }));
    expect(events.some(event => event.type === "delta" || event.type === "done")).toBe(false);
  });
});
