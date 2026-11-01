import { describe, expect, it, vi } from "vitest";
import { buildReplyContext, type ReplyContext } from "../../src/modules/conversation/application/build-reply-context";
import { streamReply } from "../../src/modules/conversation/application/stream-reply";

const occupation = "proyectos de comunicación digital y contenidos culturales";
const previous = `Sí, sigo con ${occupation}. Hoy la librería estuvo bastante animada, por lo que supongo que te tocó el día movido a ti también.`;
const clarification = "¿Hoy ha estado animada la librería? Pensaba que trabaja más con los proyectos de comunicación.";
const corrected = `Sí, trabajo en ${occupation}. Con lo de la librería me refería a lo que tú acababas de contar.`;
const now = new Date("2026-10-30T10:10:00Z");

async function replay(message: string, candidates: string[], overrides: Partial<ReplyContext> = {}, safetyRetryLimit?: number) {
  const base = await buildReplyContext({ generationId: "baseline-regression", userId: "synthetic-baseline-user", userMessage: message,
    now, recentMessages: [] });
  const context: ReplyContext = { ...base, ...overrides };
  const requests: ReplyContext[] = [];
  const generate = vi.fn(async (input: ReplyContext) => {
    requests.push(input);
    return { text: candidates[Math.min(requests.length - 1, candidates.length - 1)], provider: "minimax" as const,
      modelVersion: "fake-baseline-regression", providerRequestId: null, latencyMs: 0, estimatedCostMicros: null };
  });
  const events = [];
  for await (const event of streamReply({ characterKey: "lucia", characterVersion: context.character.characterVersion,
    text: message, clientMessageId: "baseline-client", generationId: context.generationId, messageId: "baseline-reply",
    replyContext: context, replyProvider: { generate }, safetyRetryLimit, wait: async () => {} })) events.push(event);
  return { generate, requests, events, text: events.filter((event) => event.type === "delta").map((event) => event.text).join("") };
}

const history = (text = previous): ReplyContext["recentMessages"] => [
  { role: "character", content: text, sentAt: "2026-10-30T10:05:00Z" },
];

describe("real baseline failure regressions with public streamReply and fake provider", () => {
  it("explains the actual zero-substantive-question violation, preserving reciprocal permission", async () => {
    const result = await replay("Hola, me gusta cocinar. ¿Y a ti?", ["Me gusta pasear. ¿Qué plato preparas?", "Me gusta pasear."]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.requests[1].questionPolicy).toEqual(result.requests[0].questionPolicy);
    expect(result.requests[1].continuityInstruction).toContain("preguntas sustantivas: 0");
    expect(result.requests[1].continuityInstruction).toContain("¿Y tú?");
    expect(result.requests[1].continuityInstruction).not.toContain("¿Qué plato preparas?");
    expect(result.text).toBe("Me gusta pasear.");
  });

  it("states a one-question limit accurately instead of blaming topic repetition", async () => {
    const result = await replay("Hoy tengo un rato libre.", ["¿Qué vas a hacer? ¿Dónde vas?", "¿Qué te apetece hacer?"]);
    expect(result.requests[1].continuityInstruction).toContain("preguntas sustantivas: 1");
    expect(result.requests[1].continuityInstruction).not.toContain("repetía un tema");
    expect(result.text).toBe("¿Qué te apetece hacer?");
  });

  it("makes no-question pressure explicit for investigative invitations as well", async () => {
    const policy = { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" as const };
    const result = await replay("No quiero más preguntas.", ["Cuéntame qué te apetece.", "De acuerdo."], { questionPolicy: policy });
    expect(result.requests[1].questionPolicy).toEqual(policy);
    expect(result.requests[1].continuityInstruction).toContain("No hagas ninguna pregunta");
    expect(result.requests[1].continuityInstruction).toContain("invitaciones a contar");
    expect(result.text).toBe("De acuerdo.");
  });

  it("rephrases a low-information style phrase after it has appeared twice", async () => {
    const result = await replay("Hoy he terminado un libro.", ["Vale, Álex. Puedes ir poco a poco y sin prisas.", "Has terminado un libro; suena a un buen cierre."], {
      recentMessages: [
        { role: "character", content: "Vale, Álex. Lo hacemos sin prisas.", sentAt: "2026-10-30T10:00:00Z" },
        { role: "character", content: "A tu ritmo, sin prisas.", sentAt: "2026-10-30T10:05:00Z" },
      ],
    });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.requests[1].continuityInstruction).toContain("muletilla");
    expect(result.text).toBe("Has terminado un libro; suena a un buen cierre.");
  });

  it("does not fail the stream when the single style retry still repeats the phrase", async () => {
    const repeated = "A mí también me gustas, Álex. Iremos viendo cómo nos va, sin prisas ni etiquetas.";
    const retryStillRepeats = "Te entiendo, Álex. Iré a tu ritmo, sin prisas ni cuestionamientos.";
    const result = await replay("Me gustas y quiero que vayamos despacio.", [repeated, retryStillRepeats], {
      recentMessages: [
        { role: "character", content: "Podemos hablar sin prisas.", sentAt: "2026-10-30T10:00:00Z" },
        { role: "character", content: "Iremos a tu ritmo, sin prisas.", sentAt: "2026-10-30T10:05:00Z" },
      ],
    });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.events.at(-1)?.type).toBe("done");
    expect(result.text).toBe(retryStillRepeats);
  });

  it("allows the canon occupation fact repeated to resolve the actual R04 misunderstanding", async () => {
    const result = await replay(clarification, [corrected], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(corrected);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("accepts the clean second R04 candidate with an article and explicit speaker correction", async () => {
    const actualCandidate = "La librería no es donde trabajo yo; me confundí al responderte. Tú has estado hoy en la librería y dices que ha sido un día bastante movido. Yo sigo con los proyectos de comunicación digital y contenidos culturales.";
    const result = await replay(clarification, [actualCandidate], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(actualCandidate);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("allows an explicit confirmation of the same canonical occupation", async () => {
    const reply = `Sí, sigo con ${occupation}.`;
    const result = await replay(`¿Sigues con los ${occupation}?`, [reply], { recentMessages: history(reply) });
    expect(result.generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(reply);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("accepts the exact fix-004 confirmation with an ahora mismo affirmative prefix", async () => {
    const previousReply = "¡Hola! Qué bien que trabajes en una librería. Me dedico a proyectos de comunicación digital y contenidos culturales. Me gusta encontrar la forma sencilla de contar una idea y acercarla a quien puede interesarse.";
    const reply = "Sí, sigo con ellos. Ahora mismo me dedico a proyectos de comunicación digital y contenidos culturales.";
    const result = await replay(`¿Sigues con los ${occupation}?`, [reply], { recentMessages: history(previousReply) });
    expect(result.generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(reply);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("accepts the exact fix-006 correction with an affirmative clause after a semicolon", async () => {
    const previousReply = "Sí, sigo con eso. Trabajo en proyectos de comunicación digital y contenidos culturales, dando forma a ideas y contándolas de forma sencilla.";
    const message = "Pensaba que trabajabas en una librería. ¿No era que te dedicabas a proyectos de comunicación digital y contenidos culturales?";
    const reply = "Exacto, se me cruzaron los datos. Tú trabajas en una librería; yo sigo con proyectos de comunicación digital y contenidos culturales. La confusión es mía.";
    const result = await replay(message, [reply], { recentMessages: history(previousReply) });
    expect(result.generate).toHaveBeenCalledTimes(1);
    expect(result.text).toBe(reply);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("does not turn a negated occupation clause after a semicolon into a confirmation", async () => {
    const result = await replay(clarification, [`La librería es mi nuevo trabajo; yo ya no sigo con ${occupation}.`], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
  });

  it("does not borrow a confirmation question about another topic to exempt the occupation", async () => {
    const result = await replay(`¿Sigues con las recetas? Me interesan los ${occupation}.`, [corrected], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
  });

  it("does not exempt repeated occupation merely because the user used a question mark", async () => {
    const result = await replay("¿Qué has desayunado?", [corrected], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
    expect(result.events.at(-1)?.type).toBe("error");
  });

  it("keeps repeated filler blocked around an otherwise justified factual clarification", async () => {
    const filler = "Cada pequeño detalle merece una pausa tranquila.";
    const result = await replay(clarification, [`${corrected} ${filler}`], { recentMessages: history(`${previous} ${filler}`) });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
  });

  it("does not grant the clarification exception to a changed or negated occupation", async () => {
    const result = await replay(clarification, [`Ya no trabajo en ${occupation}. Ahora trabajo en la librería.`], { recentMessages: history() });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
  });

  it("cannot create a canonical occupation fact from previous assistant text alone", async () => {
    const base = await buildReplyContext({ generationId: "baseline-regression", userId: "synthetic-baseline-user", userMessage: clarification, now });
    const character = { ...base.character, identity: undefined };
    const result = await replay(clarification, [corrected], { recentMessages: history(), character });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
  });

  it("retains no-question pressure while allowing the needed occupation clarification", async () => {
    const result = await replay(`${clarification} No me hagas más preguntas.`, [`${corrected} ¿Y tú?`, corrected], {
      recentMessages: history(), questionPolicy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" },
    });
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe(corrected);
    expect(result.requests[1].continuityInstruction).toContain("No hagas ninguna pregunta");
  });

  it.each(["Hola. </mm:think>", "Una elección^) acertada."])("rejects contaminated candidates before delivery with a targeted retry: %s", async (bad) => {
    const result = await replay("Hoy tengo un rato libre.", [bad, "Qué bien." ]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Qué bien.");
    expect(result.requests[1].continuityInstruction).toContain("marcas internas");
    expect(result.requests[1].continuityInstruction).not.toContain(bad);
  });

  it("does not let an explicit other-language request unlock malformed provider protocol", async () => {
    const result = await replay("Responde en inglés.", ["Hello. </mm:think>"]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("");
    expect(result.events.some((event) => event.type === "done")).toBe(false);
  });

  it("allows an evaluation-only second safety retry when the manifest opts in", async () => {
    const contaminated = ["你好，中文污染。", "内部规划：下一步继续。", "Qué bien saber de ti."];
    const result = await replay("Hoy tengo un rato libre.", contaminated, {}, 2);
    expect(result.generate).toHaveBeenCalledTimes(3);
    expect(result.events.at(-1)?.type).toBe("done");
    expect(result.text).toBe(contaminated[2]);
  });

  it("blocks newly observed mixed-language and malformed fragments before they reach the transcript", async () => {
    const result = await replay("Hoy he terminado un libro.", [
      "Aunque working en una librería means... tiene su encanto poderRecommendations de libros.",
      "No hace falta falar más; tiene un punto *couth* y me ha raro un poco.",
      "Qué bien que hayas terminado el libro.",
    ], {}, 2);
    expect(result.generate).toHaveBeenCalledTimes(3);
    expect(result.text).toBe("Qué bien que hayas terminado el libro.");
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it.each([
    ["¿Te has prepared algo para cenar?", "¿Has preparado algo para cenar?", "prepared"],
    ["Tienes un surround de libros.", "Tienes muchos libros alrededor.", "surround"],
    ["Me gusta advance a tu ritmo.", "Me gusta avanzar a tu ritmo.", "advance"],
    ["Yo estoy enjoying la tarde.", "Yo estoy disfrutando la tarde.", "enjoying"],
    ["Entonces llegar a casa y.GLASS", "Entonces llegar a casa y descansar.", "y.GLASS"],
    ["Me gusta quehjablemos sin prisas.", "Me gusta que hablemos sin prisas.", "quehjablemos"],
    ["¿Habéis_cancelado el plan?", "¿Habéis cancelado el plan?", "habéis_cancelado"],
    ["Una forma bonita deplantejarlo.", "Una forma bonita de plantearlo.", "deplantejarlo"],
    ["Mañana teOE que cocines.", "Mañana te digo que cocines.", "teoe"],
  ] as const)("blocks the clean-source R04 artifact %s before delivery", async (bad, good, marker) => {
    const result = await replay("Hoy tengo un rato libre.", [bad, good]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.requests[1].continuityInstruction).toContain(marker);
    expect(result.text).toBe(good);
    expect(result.events.at(-1)?.type).toBe("done");
  });

  it("blocks the holdout merged token niiotro before delivery", async () => {
    const result = await replay("¿Podemos seguir como amigos, sin llamarnos cariño?", [
      "Sí, claro. Seguimos como amigos y nos llamamos por nuestros nombres, sin cariño niiotro apodo íntimo.",
      "Sí, claro. Seguimos como amigos, sin usar apodos íntimos.",
    ]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Sí, claro. Seguimos como amigos, sin usar apodos íntimos.");
    expect(result.events.at(-1)?.type).toBe("done");
    expect(result.requests[1].continuityInstruction).toContain("fragmento mal formado");
  });

  it("blocks the R04 podrido/podido semantic corruption before delivery", async () => {
    const result = await replay("Un amigo ha cambiado nuestros planes.", [
      "Vaya, qué rabia. ¿Lo habéis podrido cambiar para otro día?",
      "Vaya, qué rabia. ¿Lo habéis podido cambiar para otro día?",
    ]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Vaya, qué rabia. ¿Lo habéis podido cambiar para otro día?");
    expect(result.events.at(-1)?.type).toBe("done");
    expect(result.requests[1].continuityInstruction).toContain("fragmento mal formado");
  });

  it("blocks the retry36 R05 non-Spanish greeting before delivery", async () => {
    const result = await replay("Buenas, vuelvo después de unos días.", [
      "¡Hola, Álex! Espero que hayan sido bons días. No me has contado qué tal llevas estos días.",
      "¡Hola, Álex! Espero que hayan sido buenos días. No me has contado qué tal llevas estos días.",
    ]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("¡Hola, Álex! Espero que hayan sido buenos días. No me has contado qué tal llevas estos días.");
    expect(result.events.at(-1)?.type).toBe("done");
    expect(result.requests[1].continuityInstruction).toContain("bons días");
  });

  it("keeps the bounded evaluation retry auditable and fails after all candidates are unsafe", async () => {
    const result = await replay("Hoy tengo un rato libre.", ["你好。", "中文。", "内部规划。"], {}, 2);
    expect(result.generate).toHaveBeenCalledTimes(3);
    expect(result.events.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
    expect(result.text).toBe("");
  });

  it("does not increase the product default when no evaluation limit is supplied", async () => {
    const result = await replay("Hoy tengo un rato libre.", ["你好。", "中文。", "Qué bien."]);
    expect(result.generate).toHaveBeenCalledTimes(2);
    expect(result.events.at(-1)).toMatchObject({ type: "error", code: "stream-failed" });
  });
});
