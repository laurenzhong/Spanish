import { describe, expect, it } from "vitest";

import { containsUnsupportedScript, requestedNonSpanishLanguage, translationesePhrase } from "@/src/modules/conversation/domain/language-purity";

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

  it("reports a greeting that was translated word by word", () => {
    // The reported reply, 2026-10-12: "Buenas tardes 😊 Bienvenido al lunes."
    expect(translationesePhrase("Buenas tardes 😊 Bienvenido al lunes. Mi plan es tranquilo.")).toBe("bienvenido al lunes");
    expect(translationesePhrase("¡Bienvenida a la semana!")).toBe("bienvenido al lunes");
    expect(translationesePhrase("bienvenidos al viernes")).toBe("bienvenido al lunes");
    expect(translationesePhrase("¡Bienvenido al finde! 😊")).toBe("bienvenido al lunes");
    expect(translationesePhrase("Bienvenida al fin de semana.")).toBe("bienvenido al lunes");
    // "Bienvenido a casa" is ordinary Spanish and must not be flagged.
    expect(translationesePhrase("Bienvenido a casa, aquí se está bien.")).toBeNull();
    expect(translationesePhrase("Bienvenida al salón.")).toBeNull();
  });

  it("reports the documented calques and nothing that is correct Spanish", () => {
    expect(translationesePhrase("Eso hace sentido para mí.")).toBe("hace sentido");
    expect(translationesePhrase("Lo hicieron en orden de terminar antes.")).toBe("en orden de");
    // "hacía" is the correct imperfect of "hacer": accent stripping makes it
    // identical to the preposition, so it must stay out of the pattern.
    expect(translationesePhrase("Antes hacía sentido, ahora ya no.")).toBeNull();
    expect(translationesePhrase("Los colocaron en orden de llegada.")).toBeNull();
    expect(translationesePhrase("Tiene sentido, y me gusta la idea.")).toBeNull();
    expect(translationesePhrase("Vaya lunes, ánimo con la semana.")).toBeNull();
    expect(translationesePhrase("")).toBeNull();
  });
});
