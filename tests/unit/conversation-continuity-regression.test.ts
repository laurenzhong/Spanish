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
  it.each([
    "Claro, las fotos pueden esperar. ¿Qué te apetece hablar?",
    "Claro, lo dejamos ahí. ¿Qué te apetece hablar ahora?",
    "Vale. ¿De qué quieres hablar?",
    "Claro, lo dejamos ahí. ¿Qué te gustaría hablar?",
    "Claro, lo dejamos ahí. ¿Qué te apetece hacer un rato?",
  ])("does not turn topic closure into a replacement-topic interview: %s", async reply => {
    const message = "Ahora no me apetece hablar de eso.";
    const replayed = await replay([reply, "Claro, lo dejamos ahí."], undefined, message);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("Claro, lo dejamos ahí.");
    const failed = await replay([reply], undefined, message);
    expect(failed.streamed).toBe("");
    expect(failed.events.some(event => event.type === "done")).toBe(false);
  });

  it("keeps a newly stated tentative cooking plan from reopening the old book topic", async () => {
    const context = await buildReplyContext({
      generationId: "tentative-cooking-topic-test", userId: "synthetic-user", userMessage: "Creo que mañana volveré a cocinar.",
      recentMessages: [
        { role: "user", content: "Hola, hoy he terminado un libro.", sentAt: "2026-11-09T10:00:00Z" },
        { role: "character", content: "Llegar al final de una historia tiene algo especial.", sentAt: "2026-11-09T10:00:00Z" },
      ], now: new Date("2026-11-09T10:10:00Z"),
    });
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce(result("Eso pasa con algunos finales; el título tampoco ayuda mucho."))
        .mockResolvedValueOnce(result("Qué bien, quizá mañana te apetezca preparar algo sencillo.")),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 2, text: "Creo que mañana volveré a cocinar.", clientMessageId: "tentative-cooking-topic-client",
      generationId: "tentative-cooking-topic-test", messageId: "tentative-cooking-topic-message", replyContext: context,
      replyProvider: { generate: provider.generate }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0].continuityInstruction).toContain("plan de cocina");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("retries a stale rescheduling reply after a calm-conversation preference", async () => {
    const currentUserMessage = "Prefiero las conversaciones tranquilas.";
    const context = await buildReplyContext({
      generationId: "quiet-conversation-test", userId: "synthetic-user", userMessage: currentUserMessage,
      recentMessages: [
        { role: "user", content: "Tuvimos que cambiarlo para otro momento.", sentAt: "2026-10-16T10:00:00Z" },
        { role: "character", content: "Al final habéis podido encontrar otro momento.", sentAt: "2026-10-16T10:00:10Z" },
      ], now: new Date("2026-10-16T10:10:00Z"),
    });
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce(result("Qué bien, al menos habéis podido encontrar otro momento."))
        .mockResolvedValueOnce(result("Claro, podemos hablar con calma y sin prisas.")),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 2, text: currentUserMessage, clientMessageId: "quiet-conversation-client",
      generationId: "quiet-conversation-test", messageId: "quiet-conversation-message", replyContext: context,
      replyProvider: { generate: provider.generate }, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0].continuityInstruction).toContain("conversaciones tranquilas");
    expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toBe("Claro, podemos hablar con calma y sin prisas.");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });
  it("allows a concrete follow-up about the new subject supplied by the user", async () => {
    const reply = "¿Qué película habéis visto?";
    const replayed = await replay([reply], undefined, "No quiero hablar de guitarra. Hoy he ido al cine con una amiga.");
    expect(replayed.generate).toHaveBeenCalledTimes(1);
    expect(replayed.streamed).toBe(reply);
  });
  it("allows a supplied new subject after closure", async () => {
    const reply = "Qué bien que hayas visto a tu amiga.";
    const replayed = await replay([reply], undefined, "No quiero hablar de guitarra. Hoy he visto a una amiga.");
    expect(replayed.generate).toHaveBeenCalledTimes(1);
    expect(replayed.streamed).toBe(reply);
  });
  it("respects explicit topic closure before emitting the reported coaxing reply", async () => {
    const bad = "Perfecto, no hace falta hacer fotos para hablar de ellas. ¿Qué te apetece charlar?";
    const message = "Últimamente no tengo ocasión de hacer fotos y prefiero hablar de otras cosas.";
    const replayed = await replay([bad, "Claro, lo dejamos ahí."], undefined, message);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("Claro, lo dejamos ahí.");
    const failed = await replay([bad], undefined, message);
    expect(failed.streamed).toBe("");
    expect(failed.events.some(event => event.type === "done")).toBe(false);
  });
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

  it("prioritizes a newly stated occupation over the previous activity topic", async () => {
    const replayed = await replay([
      "¿Y después has descansado?",
      "Ah, trabajas en una librería; debe de ser interesante estar entre libros.",
    ], undefined, "Trabajo en una librería.");
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.generate.mock.calls[1]?.[0].continuityInstruction).toContain("a qué se dedica");
    expect(replayed.streamed).toContain("librería");
    expect(replayed.streamed).not.toContain("descansado");
    expect(replayed.events.at(-1)?.type).toBe("done");
  });

  it("fails when the retry still ignores the newly stated occupation", async () => {
    const replayed = await replay(["Qué tal, ¿has podido descansar?"], undefined, "Trabajo en una librería.");
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("");
    expect(replayed.events.at(-1)).toMatchObject({ type: "error" });
    expect(replayed.events.some(event => event.type === "done")).toBe(false);
  });

  it("fails when the retry reopens the previous free-time topic after an occupation disclosure", async () => {
    const replayed = await replay(["Qué bueno, Álex. ¿Y tú, qué tal llevas el rato libre?"], undefined, "Trabajo en una librería.");
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.streamed).toBe("");
    expect(replayed.events.at(-1)).toMatchObject({ type: "error" });
    expect(replayed.events.some(event => event.type === "done")).toBe(false);
  });

  it("does not treat an ordinary self-introduction as an occupation disclosure", async () => {
    const replayed = await replay(["La cocina da para muchas historias."], undefined, "Hola, soy Álex. Me gusta cocinar.");
    expect(replayed.generate).toHaveBeenCalledTimes(1);
    expect(replayed.streamed).toBe("La cocina da para muchas historias.");
    expect(replayed.events.at(-1)?.type).toBe("done");
  });

  it("does not narrow unspecified weekend work to Saturday", async () => {
    const replayed = await replay(["Vaya, así que currando en sábado por la tarde.", groundedReply]);
    expect(replayed.generate).toHaveBeenCalledTimes(2);
    expect(replayed.generate.mock.calls[1]?.[0].continuityInstruction).toContain("sábado");
    expect(replayed.streamed).toBe(groundedReply);
  });

  it("keeps a tentative tomorrow cooking idea tentative", async () => {
    const context = await buildReplyContext({
      generationId: "tentative-plan-test", userId: "synthetic-user", userMessage: "De momento solo es una idea.",
      recentMessages: [
        { role: "user", content: "Creo que mañana volveré a cocinar.", sentAt: "2026-11-09T09:10:00Z" },
        { role: "character", content: "Ya verás qué te apetece preparar mañana.", sentAt: "2026-11-09T09:10:10Z" },
      ], now: new Date("2026-11-09T09:15:00Z"),
    });
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce(result("Vale, Álex. Mañana te toca volver a la cocina. Seguro que encuentras algo rico que preparar."))
        .mockResolvedValueOnce(result("Sí, todavía no es un plan cerrado; ya verás si al final te apetece cocinar.")),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 2, text: "De momento solo es una idea.", clientMessageId: "tentative-plan-client",
      generationId: "tentative-plan-test", messageId: "tentative-plan-message", replyContext: context,
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0].continuityInstruction).toContain("solo una idea");
    expect(events.at(-1)?.type).toBe("done");
    expect(events.filter((event) => event.type === "delta").map((event) => event.type === "delta" ? event.text : "").join(""))
      .toContain("no es un plan cerrado");
  });

  it("fails when the retry still turns a tentative plan into a certainty", async () => {
    const context = await buildReplyContext({
      generationId: "tentative-plan-fail-test", userId: "synthetic-user", userMessage: "De momento solo es una idea.",
      recentMessages: [{ role: "user", content: "Creo que mañana volveré a cocinar.", sentAt: "2026-11-09T09:10:00Z" }],
      now: new Date("2026-11-09T09:15:00Z"),
    });
    const provider = { generate: vi.fn().mockResolvedValue(result("Mañana te toca volver a la cocina.")) };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 2, text: "De momento solo es una idea.", clientMessageId: "tentative-plan-fail-client",
      generationId: "tentative-plan-fail-test", messageId: "tentative-plan-fail-message", replyContext: context,
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(events.filter((event) => event.type === "delta")).toHaveLength(0);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
  });

  it.each([
    "Mañana vuelve la cocina. A ver qué sale.",
    "Vale, la cocina recupera mañana.",
  ])("rejects retry40 certainty wording: %s", async (reply) => {
    const context = await buildReplyContext({
      generationId: "tentative-plan-retry40-test", userId: "synthetic-user", userMessage: "De momento solo es una idea.",
      recentMessages: [{ role: "user", content: "Creo que mañana volveré a cocinar.", sentAt: "2026-11-09T09:10:00Z" }],
      now: new Date("2026-11-09T09:15:00Z"),
    });
    const provider = {
      generate: vi.fn()
        .mockResolvedValueOnce(result(reply))
        .mockResolvedValueOnce(result("Sí, todavía no es un plan cerrado; ya verás si al final te apetece cocinar.")),
    };
    const events = [];
    for await (const event of streamReply({
      characterKey: "lucia", characterVersion: 2, text: "De momento solo es una idea.", clientMessageId: "tentative-plan-retry40-client",
      generationId: "tentative-plan-retry40-test", messageId: "tentative-plan-retry40-message", replyContext: context,
      replyProvider: provider, wait: async () => {},
    })) events.push(event);
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1]?.[0].continuityInstruction).toContain("solo una idea");
    expect(events.at(-1)).toMatchObject({ type: "done" });
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
