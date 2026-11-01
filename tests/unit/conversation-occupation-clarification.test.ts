import { describe, expect, it, vi } from "vitest";
import { buildReplyContext, type ReplyContext } from "../../src/modules/conversation/application/build-reply-context";
import { streamReply } from "../../src/modules/conversation/application/stream-reply";

const fact = "proyectos de comunicación digital y contenidos culturales";
const prior = `Me dedico a ${fact}.`;
const confirmation = `¿Sigues con los ${fact}?`;
const correction = `Pensaba que trabajabas en una librería. ¿No era que te dedicabas a ${fact}?`;
const holdout = "Creo que te he entendido mal. ¿Tu trabajo es en comunicación digital y contenidos culturales?";

async function replay(userMessage: string, reply: string, options: { prior?: string; noCanon?: boolean; policy?: ReplyContext["questionPolicy"] } = {}) {
  const base = await buildReplyContext({ generationId: "occupation-clarification", userId: "synthetic-occupation-user", userMessage,
    now: new Date("2026-10-25T10:00:00Z"), recentMessages: [
      { role: "user", content: "Trabajo en una librería. ¿A qué te dedicas?", sentAt: "2026-10-25T09:55:00Z" },
      { role: "character", content: options.prior ?? prior, sentAt: "2026-10-25T09:55:00Z" },
    ] });
  const context = { ...base, ...(options.noCanon ? { character: { ...base.character, identity: undefined } } : {}),
    ...(options.policy ? { questionPolicy: options.policy } : {}) };
  const generate = vi.fn(async () => ({ text: reply, provider: "minimax" as const, modelVersion: "fake-occupation",
    providerRequestId: null, latencyMs: 0, estimatedCostMicros: null }));
  const events = [];
  for await (const event of streamReply({ characterKey: "lucia", characterVersion: context.character.characterVersion,
    text: userMessage, clientMessageId: "occupation-client", generationId: context.generationId, messageId: "occupation-response",
    replyContext: context, replyProvider: { generate }, wait: async () => {} })) events.push(event);
  return { calls: generate.mock.calls.length, done: events.some(event => event.type === "done"),
    text: events.filter(event => event.type === "delta").map(event => event.text).join("") };
}

describe("canonical occupation clarification by clause", () => {
  it.each([
    ["diagnostic-008", confirmation, `Sí, sigo con eso. Ahora mismo me centro en ${fact}.`],
    ["diagnostic-021", correction, `Sí, me dedico a ${fact}. No trabajo en una librería; parece que se nos cruzaron los papeles.`],
    ["diagnostic-023", correction, `Exacto: yo me dedico a ${fact}. La librería era tu lugar de trabajo; entendí mal tu frase.`],
    ["holdout-021", holdout, `Sí, exactamente. Trabajo en ${fact}. El máster es lo que estudié para orientarme profesionalmente en ese ámbito.`],
    ["holdout-022", holdout, `Sí, exacto: me dedico a ${fact}.`],
    ["holdout-023", holdout, `Sí, exactamente. Me dedico a ${fact}.`],
  ])("accepts the previously rejected %s candidate without a retry", async (_id, user, reply) => {
    expect(await replay(user, reply)).toEqual({ calls: 1, done: true, text: reply });
  });

  it("accepts the natural 'sigo dedicándome a' continuation form", async () => {
    const reply = `La librería era tu trabajo; yo sigo dedicándome a ${fact}.`;
    expect(await replay(correction, reply)).toEqual({ calls: 1, done: true, text: reply });
  });

  it("does not treat denial of the incorrect job in the same response as denial of canon", async () => {
    const reply = `No trabajo en una librería, yo me dedico a ${fact}.`;
    expect(await replay(correction, reply)).toEqual({ calls: 1, done: true, text: reply });
  });
  it("scopes an adversative clause separately from denial of the incorrect job", async () => {
    const reply = `No trabajo en una librería pero me dedico a ${fact}.`;
    expect(await replay(correction, reply)).toEqual({ calls: 1, done: true, text: reply });
  });

  it.each([
    ["unrelated question", `¿Cómo estás? Me interesan los ${fact}.`, prior],
    ["unrelated clarification", `No entiendo la receta. Me interesan los ${fact}.`, prior],
    ["negated canon", confirmation, `No trabajo en ${fact}.`],
    ["changed occupation", confirmation, `Ya no me dedico a ${fact}; ahora trabajo en la librería.`],
    ["hypothetical", confirmation, `Si yo trabajara en ${fact}, sería interesante.`],
    ["quoted assertion", confirmation, `Antes dijiste: «Yo trabajo en ${fact}».`],
    ["user attribution", confirmation, `Tú trabajas en ${fact}.`],
    ["user occupation noun", confirmation, `Tu trabajo es en ${fact}.`],
    ["third-party attribution", confirmation, `Ella me habló de ${fact}.`],
    ["negated mental assertion", confirmation, `No creo que me dedique a ${fact}.`],
    ["mere interest", confirmation, `Me interesan los ${fact}.`],
    ["interest predicate", confirmation, `Me intereso en ${fact}.`],
    ["conditional scope across a comma", confirmation, `Si me contratan, trabajo en ${fact}.`],
    ["third-person noun ending in o", confirmation, `Mi amigo en ${fact}.`],
    ["hypothetical interest", confirmation, `Me gustaría dedicarme a ${fact}.`],
    ["past occupation", confirmation, `Me dedicaba a ${fact}.`],
    ["changed job after an affirmative fragment", confirmation, `Trabajo en ${fact}. He cambiado de trabajo; ahora trabajo en una librería.`],
    ["negation of canon after an affirmative fragment", confirmation, `Trabajo en ${fact}. No trabajo en ${fact}.`],
    ["coordinated denial of canon", confirmation, `Trabajo en ${fact} y no trabajo en ${fact}.`],
    ["diagnostic-020 invented second job", correction, `Sí, esa era mi idea: trabajo en una librería y me dedico a ${fact}. Lo de antes fue algo confuso.`],
  ])("does not exempt %s", async (_id, user, reply) => {
    expect(await replay(user, reply)).toEqual({ calls: 2, done: false, text: "" });
  });

  it("does not construct canonical facts from assistant history alone", async () => {
    expect(await replay(confirmation, prior, { noCanon: true })).toEqual({ calls: 2, done: false, text: "" });
  });
  it("does not mistake the user's job for a contradictory character occupation", async () => {
    const reply = `Tú trabajas en una librería y yo me dedico a ${fact}.`;
    expect(await replay(correction, reply)).toEqual({ calls: 1, done: true, text: reply });
  });

  it("still checks repeated surrounding filler", async () => {
    const filler = "Cada pequeño detalle merece una pausa tranquila.";
    expect(await replay(confirmation, `${prior} ${filler}`, { prior: `${prior} ${filler}` })).toEqual({ calls: 2, done: false, text: "" });
  });

  it("preserves no-question pressure", async () => {
    expect(await replay(confirmation, `${prior} ¿Y tú?`, { policy: { maxSubstantiveQuestions: 0, allowReciprocalQuestion: false, maxQuestionPressure: "none" } }))
      .toEqual({ calls: 2, done: false, text: "" });
  });
});
