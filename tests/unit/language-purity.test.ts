import { describe, expect, it } from "vitest";

import { containsUnsupportedScript, requestedNonSpanishLanguage } from "@/src/modules/conversation/domain/language-purity";

describe("language purity", () => {
  it("detects Chinese characters mixed into Spanish text", () => {
    // The exact fragment reported from a live proactive message.
    expect(containsUnsupportedScript("¿Tú sueles parar a fotografiar cosas随机 de la calle?")).toBe(true);
    expect(containsUnsupportedScript("随机")).toBe(true);
    expect(containsUnsupportedScript("请你帮我看看")).toBe(true);
    expect(containsUnsupportedScript("これはテストです")).toBe(true);
    expect(containsUnsupportedScript("안녕하세요")).toBe(true);
    // Compatibility ideographs and CJK extension blocks count as Han too.
    expect(containsUnsupportedScript("﨑")).toBe(true);
    expect(containsUnsupportedScript("𠮷")).toBe(true);
  });

  it("keeps ordinary Spanish, emoji and Chinese punctuation out of the guard", () => {
    expect(containsUnsupportedScript("Oye, me crucé con una fachada con azulejos increíbles en Malasaña.")).toBe(false);
    expect(containsUnsupportedScript("Te echo de menos. 😊")).toBe(false);
    expect(containsUnsupportedScript("¡Hola! ¿Cómo va todo?")).toBe(false);
    expect(containsUnsupportedScript("")).toBe(false);
  });

  it("only reports a language switch when the user explicitly requested one", () => {
    expect(requestedNonSpanishLanguage("¿Puedes responder en inglés, por favor?")).toBe(true);
    expect(requestedNonSpanishLanguage("Please answer in English.")).toBe(true);
    expect(requestedNonSpanishLanguage("用中文回复我")).toBe(true);
    expect(requestedNonSpanishLanguage("请用中文解释这句话")).toBe(true);
    expect(requestedNonSpanishLanguage("No me hables en español, por favor.")).toBe(true);
    expect(requestedNonSpanishLanguage("Cambia a inglés.")).toBe(true);
  });

  it("does not treat ordinary Spanish conversation as a language request", () => {
    expect(requestedNonSpanishLanguage("¡Hola! ¿Cómo va todo?")).toBe(false);
    expect(requestedNonSpanishLanguage("¿Qué tal tu día?")).toBe(false);
    expect(requestedNonSpanishLanguage("Me gusta leer en español por la noche.")).toBe(false);
    expect(requestedNonSpanishLanguage("¿Estás en Madrid ahora?")).toBe(false);
    expect(requestedNonSpanishLanguage("")).toBe(false);
  });
});
