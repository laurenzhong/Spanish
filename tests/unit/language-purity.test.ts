import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  containsUnsupportedScript,
  englishFragment,
  englishFragments,
  fragmentQuotedFromUserMessage,
  requestedNonSpanishLanguage,
  translationesePhrase,
} from "@/src/modules/conversation/domain/language-purity";

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

  it("reports English words mixed into an otherwise Spanish message", () => {
    // Regression: the live proactive message reported on 2026-10-23.
    expect(englishFragment("Buenos días. Acabo de Wake Up y foster me he acordado de ti. Oye, ¿has desayunado ya?"))
      .toEqual({ phrase: "wake up", tokens: ["wake", "up"] });
    expect(englishFragment("Hoy el día está raro, but me apetece salir.")).toEqual({ phrase: "but", tokens: ["but"] });
    expect(englishFragment("Good morning, ¿cómo va todo?")).toEqual({ phrase: "good morning", tokens: ["good", "morning"] });
    expect(englishFragment("I'm fine, thank you.")).toEqual({ phrase: "thank you", tokens: ["thank", "you"] });
    expect(englishFragment("Nos vemos, see you.")).toEqual({ phrase: "see you", tokens: ["see", "you"] });
    expect(englishFragment("Wake-up, que llegas tarde.")).toEqual({ phrase: "wake up", tokens: ["wake", "up"] });
    // Short English reactions are a common leak shape too.
    expect(englishFragment("That's great, me alegro mucho.")).toEqual({ phrase: "that s great", tokens: ["that", "s", "great"] });
    expect(englishFragment("Oye, by the way, mañana nos vemos.")).toEqual({ phrase: "by the way", tokens: ["by", "the", "way"] });
    expect(englishFragment("I miss you, pero estoy bien.")).toEqual({ phrase: "i miss you", tokens: ["i", "miss", "you"] });
    // A lowercase English word in a Spanish sentence is the actual leak shape;
    // an unknown English content word stays out of this bounded detector.
    expect(englishFragment("Yes, I love it.")).toMatchObject({ phrase: "it" });
    expect(englishFragments("The Crown is great, I love it.").map((fragment) => fragment.phrase))
      .toEqual(["is", "it"]);
    // The reported word itself is still caught when the model writes it lowercase;
    // a capitalized "Foster" is a surname and is left alone.
    expect(englishFragment("Acabo de despertarme y foster me he acordado de ti."))
      .toEqual({ phrase: "foster", tokens: ["foster"] });
    expect(englishFragment("Vi una peli de Jodie Foster el otro día.")).toBeNull();
    expect(englishFragment("Foster's me cae bien como marca.")).toBeNull();
    // "are" fires only when it is literally lowercase; accent stripping turns
    // Spanish "aré" into "are", so the exact-surface check is required.
    expect(englishFragment("You are amazing.")).toEqual({ phrase: "are", tokens: ["are"] });
    expect(englishFragment("The Beatles are great.")).toEqual({ phrase: "are", tokens: ["are"] });
    expect(englishFragment("We are here.")).toEqual({ phrase: "are", tokens: ["are"] });
    expect(englishFragment("They are late.")).toEqual({ phrase: "are", tokens: ["are"] });
  });

  it("treats a capitalized English word as a title, name or acronym instead of contamination", () => {
    // Real es-ES chat mixes English titles, band names, brands and acronyms in.
    expect(englishFragment("Me encanta The Beatles.")).toBeNull();
    expect(englishFragment("Estoy escuchando My Chemical Romance.")).toBeNull();
    expect(englishFragment("Hoy tengo reunión con el equipo de IT.")).toBeNull();
    expect(englishFragment("Trabajo en el sector IT desde hace años.")).toBeNull();
    expect(englishFragment("Mi sobrino tiene síndrome de Down.")).toBeNull();
    expect(englishFragment("Hoy he leído una historia sobre el síndrome de Down.")).toBeNull();
    expect(englishFragment("Anoche vi It y no dormí en toda la noche.")).toBeNull();
    expect(englishFragment("Estoy con Doctor Who, llevo tres temporadas.")).toBeNull();
    expect(englishFragment("Me he visto After otra vez.")).toBeNull();
    expect(englishFragment("Vi Up con mi sobrino.")).toBeNull();
    expect(englishFragment("¿Has visto el US Open? Menudo partido.")).toBeNull();
    expect(englishFragment("En Pull and Bear siempre encuentro algo.")).toBeNull();
    expect(englishFragment("El rock and roll de los 50 no se ha superado.")).toBeNull();
    expect(englishFragment("Estoy leyendo Of Mice and Men para clase.")).toBeNull();
    // "aré" is ordinary Spanish; accent stripping must not turn it into "are".
    expect(englishFragment("Mañana aré el huerto de mi abuelo temprano.")).toBeNull();
  });

  it("keeps Spanish sentences that use anglicisms, Latin phrases, names or time abbreviations out of the guard", () => {
    expect(englishFragment("Me he comprado un selfie stick y he hecho un directo online.")).toBeNull();
    expect(englishFragment("El test de idioma fue in situ y salió bien.")).toBeNull();
    expect(englishFragment("Quedamos en el afterwork del viernes.")).toBeNull();
    expect(englishFragment("Me gusta el yoga y el fitness.")).toBeNull();
    expect(englishFragment("Tengo un email de Lucía y un post de Instagram.")).toBeNull();
    expect(englishFragment("Hoy ha habido un meeting rápido y luego un break.")).toBeNull();
    expect(englishFragment("Las 10 am me parecen muy pronto.")).toBeNull();
    expect(englishFragment("El rey Juan I llegó al trono en el siglo XIV.")).toBeNull();
    expect(englishFragment("Le di un like a su foto y un match en la app.")).toBeNull();
    expect(englishFragment("Voy a hacer un sprint para acabar el deadline.")).toBeNull();
    expect(englishFragment("Hoy estoy un poco down, pero se me pasa con tu mensaje.")).toBeNull();
    expect(englishFragment("El after de la boda fue lo mejor.")).toBeNull();
    expect(englishFragment("Me tiraría al over, pero con cuidado.")).toBeNull();
    expect(englishFragment("No way, tío, no me lo puedo creer.")).toBeNull();
    expect(englishFragment("Good luck con el examen, seguro que te va genial.")).toBeNull();
    expect(englishFragment("Hoy toca descansar: sofá, serie y manta con café y tostadas.")).toBeNull();
    expect(englishFragment("")).toBeNull();
  });

  it("only allows quoting English the learner wrote in the current turn", () => {
    const quoted = englishFragment("Significa 'wake up' en inglés.");
    expect(quoted).not.toBeNull();
    expect(fragmentQuotedFromUserMessage("¿Qué significa 'wake up'?", quoted!)).toBe(true);
    expect(fragmentQuotedFromUserMessage("Hoy me apetece un café.", quoted!)).toBe(false);
    expect(fragmentQuotedFromUserMessage("¿Qué significa 'thank you'?", quoted!)).toBe(false);
    expect(fragmentQuotedFromUserMessage("", quoted!)).toBe(false);
  });

  it("keeps every English marker out of the shipped Spanish frequency list", () => {
    // Guards future additions to the marker list: a word the product already
    // treats as Spanish vocabulary here would turn a natural es-ES sentence
    // into a false safety-gate hit.
    const frequency = JSON.parse(readFileSync(
      join(process.cwd(), "content", "word-lists", "es-frequency-v1.json"),
      "utf8",
    )) as { words: readonly string[] };
    expect(frequency.words.length).toBeGreaterThan(1_000);
    expect(frequency.words.filter((word) => englishFragment(word) !== null)).toEqual([]);
  });
});
