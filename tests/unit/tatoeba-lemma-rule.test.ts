import { describe, expect, it } from "vitest";

import { foldLemmaForm, matchedLemmaForm } from "@/scripts/build-tatoeba-example-asset";

/**
 * The lemma rule that decides whether a Tatoeba sentence is an example of a shelf word.
 *
 * It is a **domain rule**, not script plumbing: it decides what a reader is shown under a
 * word, and getting it wrong is silent — a bad match looks like a sentence that simply uses
 * the word. It was written and validated inside the asset builder, where 73 boundary
 * assertions ran from an inline script, which means none of them were in CI. This file is
 * that check made permanent.
 *
 * Every case below is here for a reason worth stating, because the rule is a compromise
 * between recall (Spanish conjugates, so a bare-token rule finds almost nothing) and
 * precision (accepting the wrong word is worse than showing nothing):
 *
 * - **Recall**: the corpus writes verbs in inflected and clitic forms, so `haber` almost
 *   never appears as `haber`. Measured on the built asset, 788 of 2,232 examples (35%) match
 *   an inflected or clitic form — invisible to a bare-token rule.
 * - **Precision**: the rule must still refuse a different word that shares a stem, and the
 *   pairs below (`habas`/`haber`, `sabio`/`saber`, `podio`/`poder`, `tenia`/`tener`,
 *   `vía`/`ver`) are the ones that a naive prefix or accent-folded rule accepts.
 */

/** The exact form the rule matched, or null. Named to keep the assertions readable. */
function match(sentence: string, word: string): string | null {
  return matchedLemmaForm(sentence, word);
}

describe("matchedLemmaForm — recall", () => {
  it("accepts the headword itself", () => {
    expect(match("Bebo agua.", "agua")).toBe("agua");
    expect(match("¿Tienen casa?", "casa")).toBe("casa");
  });

  it("accepts a regular conjugation", () => {
    expect(match("¿Habéis despertado?", "haber")).toBe("Habéis");
    expect(match("No había gatos.", "haber")).toBe("había");
    expect(match("Podemos irnos.", "poder")).toBe("Podemos");
    expect(match("Queremos paz.", "querer")).toBe("Queremos");
  });

  it("accepts an inflected form attached to a clitic pronoun", () => {
    // The pronoun moves the stress, so this path compares folded — otherwise `habérselo`
    // could never match.
    expect(match("Debo haberme olvidado.", "haber")).toBe("haberme");
    expect(match("Recuerdo haberlo visto.", "haber")).toBe("haberlo");
  });

  it("accepts a noun plural", () => {
    expect(match("Las casas son grandes.", "casa")).toBe("casas");
  });

  it("accepts a form of a reflexive infinitive when the reflexive marker is present", () => {
    expect(match("Se venden casas.", "venderse")).toBe("venden");
  });

  it("folds accents and case on the stem, so an unaccented sentence still matches", () => {
    // The *stem* folds: `escuadrón` is found in `escuadron`, and case never matters. The
    // ending is a different matter — see the accented-ending test below, where folding
    // would accept another word.
    expect(match("El escuadron volo.", "escuadrón")).toBe("escuadron");
    expect(match("HABIA una vez.", "haber")).toBeNull();
    expect(match("HABÍA una vez.", "haber")).toBe("HABÍA");
  });
});

describe("matchedLemmaForm — precision", () => {
  it("refuses a different word that merely shares the stem", () => {
    // These are the cases a prefix rule gets wrong. Each is a real Spanish word.
    expect(match("Las habas están ricas.", "haber")).toBeNull();
    expect(match("El hombre sabio calla.", "saber")).toBeNull();
    expect(match("Subió al podio.", "poder")).toBeNull();
    expect(match("Tengo una tenia.", "tener")).toBeNull();
  });

  it("refuses a short stem plus an ending that makes another word", () => {
    // Stems under three letters are excluded from the verb path precisely for these:
    // `ver`+`ía`, `dar`+`e`, `oler`+`a`, `ser`+`ed`.
    expect(match("La vía está cerrada.", "ver")).toBeNull();
    expect(match("Dame el libro.", "dar")).toBeNull();
    expect(match("La ola es grande.", "oler")).toBeNull();
    expect(match("Tengo sed.", "ser")).toBeNull();
  });

  it("requires an accented ending to keep its accent", () => {
    // Folding these would accept a different word: `tenia` (tapeworm), `sabia` (wise).
    expect(match("Tenía razón.", "tener")).toBe("Tenía");
    expect(match("La tenia es un parásito.", "tener")).toBeNull();
    expect(match("Era una mujer sabia.", "saber")).toBeNull();
  });

  it("refuses when the word is not there at all", () => {
    expect(match("Hoy hace sol.", "casa")).toBeNull();
    expect(match("", "casa")).toBeNull();
  });
});

describe("foldLemmaForm", () => {
  it("keeps ñ apart from n", () => {
    // `normalizeSpanishSurface` folds both to `n`, which would make `año` an example of
    // `ano` and `uña` one of `una`. `ñ` is its own letter, not an accented `n`.
    expect(foldLemmaForm("año")).toBe("año");
    expect(foldLemmaForm("ano")).toBe("ano");
    expect(foldLemmaForm("uña")).not.toBe(foldLemmaForm("una"));
    expect(match("El año pasado.", "ano")).toBeNull();
  });

  it("folds stress accents and case, and is length preserving for the ending table", () => {
    expect(foldLemmaForm("Había")).toBe("habia");
    expect(foldLemmaForm("ESCUADRÓN")).toBe("escuadron");
    // The ending table is indexed by character position, so folding must not change length.
    for (const value of ["había", "escudriñó", "pingüino", "casa"]) {
      expect(foldLemmaForm(value)).toHaveLength(value.length);
    }
  });

  it("folds the diaeresis, which separates no two words", () => {
    expect(foldLemmaForm("pingüino")).toBe("pinguino");
  });
});
