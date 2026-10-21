import { describe, expect, it, vi } from "vitest";
import { buildReplyContext, type ReplyContext } from "@/src/modules/conversation/application/build-reply-context";
import { streamReply } from "@/src/modules/conversation/application/stream-reply";

const userMessage = "Por la tarde me fui a currar.";
const history = [
  { role: "character" as const, content: "¿Te apetecía salir a caminar un rato o prefieres un café con calma?", sentAt: "2026-10-16T08:18:00Z" },
  { role: "user" as const, content: "Sí, hoy es fin de semana.", sentAt: "2026-10-16T08:24:00Z" },
  { role: "character" as const, content: "Un café con calma suena bien, que hoy arranco con la cabeza en las nubes. ¿Y tú al final saliste a caminar o te quedaste en casa?", sentAt: "2026-10-16T08:24:10Z" },
];
const staleQuestion = "¿Tú al final qué vas a hacer hoy, plan tranquilo o salir a pillar ese aire que tanto pide el cuerpo?";
const groundedReply = "Vaya, currando en finde. ¿Qué tal ha ido la tarde?";
const result = (text: string) => ({ text, provider: "minimax" as const, modelVersion: "offline-test", providerRequestId: null, latencyMs: 1, estimatedCostMicros: null });

async function replay(replies: readonly string[], signal?: AbortSignal, currentUserMessage = userMessage) {
  const context = await buildReplyContext({
    generationId: "continuity-test", userId: "synthetic-user", userMessage: currentUserMessage,
    recentMessages: history, now: new Date("2026-10-16T10:10:00Z"),
  });
  let attempt = 0;
  const generate = vi.fn(async (context: ReplyContext) => {
    expect(context.userMessage).toBe(currentUserMessage);
    return result(replies[Math.min(attempt++, replies.length - 1)]!);
  });
  const events = [];
  for await (const event of streamReply({
    characterKey: "lucia", characterVersion: 2, text: currentUserMessage, clientMessageId: "continuity-client",
    generationId: "continuity-test", messageId: "continuity-message", replyContext: context,
    replyProvider: { generate }, signal, wait: async () => {},
  })) events.push(event);
  return { generate, events, streamed: events.filter((event) => event.type === "delta").map((event) => event.text).join("") };
}

describe("reported weekend conversation regression", () => {
  it.each([staleQuestion, `¡Bienvenido al finde! 😊 ${staleQuestion}`])("retries the stale question before emitting any of it: %s", async (reply) => {
    const replayed = await replay([reply, groundedReply]);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.generate.mock.calls[1]?.[0]).toMatchObject({
      userMessage,
      continuityInstruction: expect.stringContaining("último mensaje"),
    });
    expect(replayed.streamed).toBe(groundedReply);
    expect(replayed.events.at(-1)?.type).toBe("done");
  });

  it.each([staleQuestion, "Al final pillaste café y curro.", "Vaya, currando en sábado."])("fails without partial text or done when the retry repeats the defect: %s", async (reply) => {
    const replayed = await replay([reply]);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("");
    expect(replayed.events.at(-1)).toMatchObject({ type: "error" });
    expect(replayed.events.some((event) => event.type === "done")).toBe(false);
  });

  it("accepts a grounded response on the first attempt", async () => {
    const replayed = await replay([groundedReply]);
    expect(replayed.generate).toHaveBeenCalledTimes(1);
    expect(replayed.streamed).toBe(groundedReply);
  });

  it("does not turn the character's coffee suggestion into a completed user activity", async () => {
    const replayed = await replay(["Qué bien, al final pillaste café y curro, la tarde completa.", groundedReply]);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.generate.mock.calls[1]?.[0].continuityInstruction).toContain("café");
    expect(replayed.streamed).toBe(groundedReply);
  });

  it("does not narrow unspecified weekend work to Saturday", async () => {
    const replayed = await replay(["Vaya, así que currando en sábado por la tarde.", groundedReply]);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.generate.mock.calls[1]?.[0].continuityInstruction).toContain("sábado");
    expect(replayed.streamed).toBe(groundedReply);
  });

  it.each([
    ["Ahora sí he terminado. ¿Qué me recomiendas hacer esta noche?", "¿Buscas algo tranquilo para desconectar o te apetece algo más animado?"],
    ["Ahora sí he terminado. ¿Qué me recomiendas hacer esta noche?", "Yo me pediría algo para cenar. ¿Te va más el plan tranquilo en casa o te queda energía para salir un rato?"],
    ["Perdona, no entendí tu pregunta de antes. ¿Puedes repetir la pregunta?", "Te preguntaba: ¿prefieres salir a pasear o quedarte en casa?"],
    ["¿Puedes repetir la pregunta?", "¿Y tú al final saliste a caminar o te quedaste en casa?"],
  ])("allows one relevant clarification when the user reopens planning or requests repetition: %s", async (currentUserMessage, reply) => {
    const replayed = await replay([reply], undefined, currentUserMessage);
    expect(replayed.generate).toHaveBeenCalledTimes(1);
    expect(replayed.streamed).toBe(reply);
    expect(replayed.events.at(-1)?.type).toBe("done");
  });

  it("does not generate after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const replayed = await replay([staleQuestion], controller.signal);
    expect(replayed.generate).not.toHaveBeenCalled();
    expect(replayed.streamed).toBe("");
    expect(replayed.events.at(-1)).toMatchObject({ type: "error", code: "stream-aborted" });
  });

  it("still rejects stacked substantive questions after an activity advice request", async () => {
    const replayed = await replay(["¿Buscas algo tranquilo? ¿Quieres ver una película?"], undefined, "¿Qué me recomiendas hacer esta noche?");
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("");
    expect(replayed.events.at(-1)?.type).toBe("error");
  });
});
