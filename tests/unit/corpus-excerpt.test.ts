import { describe, expect, it } from "vitest";
import { corpusArticleExcerpt } from "@/src/modules/lexicon-corpus/domain/corpus-excerpt";

const beginning = "Esta es una introducción sobre la vida cotidiana y las costumbres de quienes viven en esta ciudad. ".repeat(4);
const ending = " Más tarde, todo el mundo regresa a casa para descansar y preparar el día siguiente.";

describe("complete article sentence excerpts", () => {
  it("brings a late match into view without cutting its sentence or punctuation", () => {
    const sentence = "Por eso, María toma café antes de salir.";
    const text = beginning + sentence + ending;
    const excerpt = corpusArticleExcerpt(text, "por eso", "phrase");
    expect(excerpt).toBe(sentence);
    expect(text).toContain(excerpt);
  });

  it("keeps all matches and intervening sentences in their original order", () => {
    const span = "María toma café. Después, descansa un rato. Por eso, llega tarde.";
    expect(corpusArticleExcerpt(beginning + span + ending, "cafe tarde", "all")).toBe(span + ending);
    expect(corpusArticleExcerpt(beginning + span + " Por eso, vuelve a casa." + ending, "por eso", "phrase")).toBe("Por eso, llega tarde. Por eso, vuelve a casa.");
  });

  it("uses complete opening sentences while browsing and preserves short original paragraphs", () => {
    const sentence = "¿Quieres salir? ¡Vamos al parque!";
    expect(corpusArticleExcerpt(sentence + " " + beginning, "", "phrase")).toBe(sentence);
    expect(corpusArticleExcerpt(sentence, "salir", "phrase")).toBe(sentence);
  });

  it("retains the full original when no safe excerpt is available", () => {
    expect(corpusArticleExcerpt(beginning, "missing", "phrase")).toBe(beginning);
    const single = "palabra ".repeat(60);
    expect(corpusArticleExcerpt(single, "palabra", "phrase")).toBe(single);
  });
});
