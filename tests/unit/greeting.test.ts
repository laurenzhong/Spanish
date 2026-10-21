import { describe, expect, it } from "vitest";

import { buildReplyContext } from "@/src/modules/conversation/application/build-reply-context";
import { greetingOpener, hasGreetedOnLocalDate } from "@/src/modules/conversation/domain/greeting";

describe("greeting opener", () => {
  it.each([
    ["Buenas tardes 😊 Tranquilo total entonces.", "buenas tardes"],
    ["¡Hola! ¿Qué tal te va con el día gris?", "hola"],
    ["Hola, Lucía.", "hola"],
    ["  buenas", "buenas"],
    ["Buenas noches 🌙 Que descanses.", "buenas noches"],
    ["¿Qué tal, Lucía?", "que tal"],
    ["Buenas noticias: ya está el proyecto.", null],
    ["Uff, los días de lluvia tienen su magia.", null],
    ["Ánimo con el lunes.", null],
  ])("detects the opener of %s", (text, expected) => {
    expect(greetingOpener(text)).toBe(expected);
  });
});

describe("same-day greeting history", () => {
  const messages = [
    { role: "character" as const, content: "¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
    { role: "user" as const, content: "Estoy muy bien, hoy en mi ciudad ha llovido.", sentAt: "2026-10-21T08:47:00.000Z" },
    { role: "character" as const, content: "Uff, los días de lluvia me vuelven un poco loca para fotografiar.", sentAt: "2026-10-21T08:53:03.000Z" },
  ];

  it("finds an earlier same-day greeting even when the latest character message does not greet", () => {
    expect(hasGreetedOnLocalDate(messages, "2026-10-21", "Europe/Madrid")).toBe(true);
  });

  it("does not carry a greeting across the local day boundary", () => {
    expect(hasGreetedOnLocalDate(messages, "2026-10-22", "Europe/Madrid")).toBe(false);
  });

  it("does not count the user's greeting as the character's", () => {
    expect(hasGreetedOnLocalDate([
      { role: "user", content: "¡Hola! ¿Qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
    ], "2026-10-21", "Europe/Madrid")).toBe(false);
  });

  it("ignores messages without a parseable timestamp", () => {
    expect(hasGreetedOnLocalDate([
      { role: "character", content: "¡Hola! ¿Qué tal?" },
      { role: "character", content: "Buenas tardes 😊", sentAt: "not-a-date" },
    ], "2026-10-21", "Europe/Madrid")).toBe(false);
  });
});

describe("reply context greeting projection", () => {
  const history = [
    { role: "character" as const, content: "¡Hola! Yo bien, ya funcionando a tope. ¿Tú qué tal?", sentAt: "2026-10-21T08:40:45.000Z" },
    { role: "character" as const, content: "Uff, los días de lluvia me vuelven un poco loca para fotografiar.", sentAt: "2026-10-21T08:53:03.000Z" },
  ];

  it("marks a same-day character greeting", async () => {
    const context = await buildReplyContext({
      generationId: "greeting-context", userId: "user-1", userMessage: "Pues sí, es una buena idea.",
      recentMessages: history, now: new Date("2026-10-21T09:00:00.000Z"),
    });
    expect(context.alreadyGreetedToday).toBe(true);
  });

  it("does not mark the next local day as greeted", async () => {
    const context = await buildReplyContext({
      generationId: "greeting-next-day", userId: "user-1", userMessage: "Pues sí, es una buena idea.",
      recentMessages: history, now: new Date("2026-10-22T09:00:00.000Z"),
    });
    expect(context.alreadyGreetedToday).toBe(false);
  });
});
