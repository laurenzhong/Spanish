import { describe, expect, it } from "vitest";
import { attributesUnconfirmedCoffee, narrowsUnspecifiedWeekendWork, repeatsDailyActivityQuestion } from "@/src/modules/conversation/domain/reply-continuity";

const context = {
  userMessage: "Por la tarde me fui a currar.",
  conversationTimeZone: "Europe/Madrid",
  currentLocalDate: "2026-10-16",
  recentMessages: [
    { role: "character" as const, content: "¿Te apetecía salir a caminar un rato o prefieres un café con calma?", sentAt: "2026-10-16T08:18:00Z" },
    { role: "user" as const, content: "Sí, hoy es fin de semana.", sentAt: "2026-10-16T08:24:00Z" },
    { role: "character" as const, content: "Un café con calma suena bien. ¿Y tú al final saliste a caminar o te quedaste en casa?", sentAt: "2026-10-16T08:24:10Z" },
  ],
};

describe("daily activity question continuity", () => {
  it.each([
    "¿Tú al final qué vas a hacer hoy, plan tranquilo o salir a pillar ese aire que tanto pide el cuerpo?",
    "¿Qué planes tienes hoy?",
    "¿Prefieres quedarte en casa o salir a pasear?",
  ])("detects a paraphrased character question after a declarative update: %s", (reply) => {
    expect(repeatsDailyActivityQuestion(context, reply)).toBe(true);
  });

  it.each([
    "Vaya, currando en finde. ¿Qué tal ha ido la tarde?",
    "¿Sigues en el trabajo?",
    "¿Qué vas a hacer en el trabajo?",
    "¿Qué vas a hacer hoy en el trabajo?",
    "¿Qué piensas hacer con el informe?",
    "¿Y ahora qué vas a hacer?",
    "¿Qué vas a hacer esta noche?",
    "¿Qué planes tienes mañana?",
    "Yo hoy voy a salir a pasear.",
  ])("allows a grounded follow-up, new time window or self-report: %s", (reply) => {
    expect(repeatsDailyActivityQuestion(context, reply)).toBe(false);
  });

  it("allows a first question, a new local day and unknown timestamps", () => {
    const reply = "¿Qué planes tienes hoy?";
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages: [] }, reply)).toBe(false);
    expect(repeatsDailyActivityQuestion({ ...context, currentLocalDate: "2026-10-17" }, reply)).toBe(false);
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages: context.recentMessages.map((message) => ({ ...message, sentAt: undefined })) }, reply)).toBe(false);
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages: context.recentMessages.map((message) => ({ ...message, role: "user" as const })) }, reply)).toBe(false);
  });

  it("lets the user explicitly request the question again or reopen planning", () => {
    for (const userMessage of ["¿Puedes repetir la pregunta?", "No entendí, ¿qué me habías preguntado?", "No sé qué hacer hoy, ¿me das ideas?"]) {
      expect(repeatsDailyActivityQuestion({ ...context, userMessage }, "¿Prefieres quedarte en casa o salir a pasear?")).toBe(false);
    }
  });

  it("allows an explicit request for advice even when that window was already discussed", () => {
    expect(repeatsDailyActivityQuestion({ ...context, userMessage: "¿Qué me recomiendas hacer esta noche?", recentMessages: [
      { role: "character", content: "¿Qué vas a hacer esta noche?", sentAt: "2026-10-16T08:18:00Z" },
    ] }, "¿Prefieres salir a pasear o quedarte en casa esta noche?")).toBe(false);
  });

  it("uses the user's newly opened time window when the follow-up omits it", () => {
    expect(repeatsDailyActivityQuestion({ ...context, userMessage: "Ahora sí he terminado. ¿Qué me recomiendas hacer esta noche?" },
      "Yo me pediría algo para cenar. ¿Te va más el plan tranquilo en casa o te queda energía para salir un rato?",
    )).toBe(false);
    expect(repeatsDailyActivityQuestion({ ...context, userMessage: "¿Qué me recomiendas hacer esta noche?" }, "¿Qué planes tienes hoy?")).toBe(true);
  });

  it("uses the conversation calendar rather than the UTC date", () => {
    const reply = "¿Qué planes tienes hoy?";
    const recentMessages = [{ role: "character" as const, content: reply, sentAt: "2026-10-15T22:30:00Z" }];
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages }, reply)).toBe(true);
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages, currentLocalDate: "2026-10-15" }, reply)).toBe(false);
    expect(repeatsDailyActivityQuestion({ ...context, recentMessages: [{ ...recentMessages[0]!, sentAt: "invalid" }] }, reply)).toBe(false);
  });
});

describe("bounded speaker attribution regression", () => {
  it.each(["Vaya, currando en sábado por la tarde.", "Pues vaya plan de domingo."])("rejects narrowing weekend work: %s", (reply) => {
    expect(narrowsUnspecifiedWeekendWork(context, reply)).toBe(true);
  });

  it.each(["¿Trabajaste el sábado?", "Yo estaba trabajando en sábado.", "Podrías trabajar el sábado próximo.", "Vaya, currando en finde."])("preserves questions, self-reports and future suggestions: %s", (reply) => {
    expect(narrowsUnspecifiedWeekendWork(context, reply)).toBe(false);
  });

  it("preserves an explicitly user-supplied day and does not interpret unrelated turns", () => {
    expect(narrowsUnspecifiedWeekendWork({ ...context, userMessage: "El sábado me fui a currar." }, "Currando en sábado.")).toBe(false);
    expect(narrowsUnspecifiedWeekendWork({ ...context, userMessage: "¿Qué hago esta noche?" }, "Pues vaya plan de sábado.")).toBe(false);
    expect(narrowsUnspecifiedWeekendWork({ ...context, recentMessages: [] }, "Currando en sábado.")).toBe(false);
  });

  it.each(["Al final pillaste café y curro.", "Ya tomaste un café.", "Te has tomado ese café."])("rejects a completed coffee claim sourced only from the character: %s", (reply) => {
    expect(attributesUnconfirmedCoffee(context, reply)).toBe(true);
  });

  it.each(["¿Tomaste café?", "Yo tomé café.", "Podrías tomar un café.", "Si tomaste café, quizá no tengas sueño.", "No sé si tomaste café."])("preserves questions, self-reports and hypothetical suggestions: %s", (reply) => {
    expect(attributesUnconfirmedCoffee(context, reply)).toBe(false);
  });

  it("does not treat absent mentions as disproof when user context contains coffee", () => {
    const reply = "Al final pillaste café y curro.";
    expect(attributesUnconfirmedCoffee({ ...context, userMessage: "Me tomé un café antes de ir a currar." }, reply)).toBe(false);
    expect(attributesUnconfirmedCoffee({ ...context, recentMessages: [...context.recentMessages, { role: "user", content: "He tomado café." }] }, reply)).toBe(false);
    expect(attributesUnconfirmedCoffee({ ...context, rollingSummary: "La persona tomó café." }, reply)).toBe(false);
    expect(attributesUnconfirmedCoffee({ ...context, memories: [{ content: "Tomó café esta tarde." }] }, reply)).toBe(false);
    expect(attributesUnconfirmedCoffee({ ...context, recentMessages: [] }, reply)).toBe(false);
  });
});
