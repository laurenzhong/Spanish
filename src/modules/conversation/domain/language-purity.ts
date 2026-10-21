/**
 * Characters outside the scripts a Spanish reply is expected to use.
 *
 * The reported defect was a proactive Lucía message that contained the Chinese
 * word "随机" inside an otherwise Spanish sentence. The model emits such
 * fragments because it is Chinese-facing, and no prompt string can guarantee
 * language purity: prompt text is not a boundary. This module is the code-level
 * boundary the safety gates use instead.
 *
 * `Script=Han` already covers the full CJK unified ideograph ranges, so
 * compatibility ideographs and the rare CJK additions are included.
 */
const unsupportedScriptPattern =
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u;

/** True when text carries characters whose script Spanish does not use. */
export function containsUnsupportedScript(text: string): boolean {
  return unsupportedScriptPattern.test(text);
}

/**
 * Literal translations the model produces when it renders a greeting word by
 * word from Chinese or English. They are grammatical Spanish, so every script
 * and safety check passes them; the learner would still copy language nobody
 * says.
 *
 * Each entry comes either from a reported reply or from a well-documented
 * anglicism of the `es-ES` variety the content pipeline reviews against. The
 * list stays short and high-precision on purpose: it triggers a retry, so a
 * wrong entry costs a provider call while a missing entry only costs the
 * prompt's own guidance. Accents are already stripped before matching.
 */
const translationesePatterns: readonly Readonly<{ phrase: string; pattern: RegExp }>[] = [
  {
    // Reported on 2026-10-12: "Buenas tardes 😊 Bienvenido al lunes." Spanish
    // says "Vaya lunes" or "Ánimo con el lunes"; "bienvenido al lunes" is
    // "welcome to Monday" rendered word by word. "Bienvenido a casa" stays
    // untouched because the pattern requires a day, week or weekend after it.
    phrase: "bienvenido al lunes",
    pattern: /\bbienvenid[oa]s?\s+(?:a\s+la\s+|al\s+|a\s+)?(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana|finde|fin\s+de\s+semana)\b/u,
  },
  {
    // Anglicism for "make sense"; es-ES uses "tiene sentido". "Hacia sentido"
    // is deliberately absent: it is the correct imperfect of "hacer", and
    // accent stripping makes it indistinguishable from the preposition.
    phrase: "hace sentido",
    pattern: /\bhac(?:e|en)\s+sentido\b/u,
  },
  {
    // Calque of "in order to"; Spanish uses "para". Requiring an infinitive
    // keeps "en orden de llegada" and "en orden de importancia" out.
    phrase: "en orden de",
    pattern: /\ben\s+orden\s+de\s+\p{L}{2,}(?:ar|er|ir)\b/u,
  },
];

/** The first literal-translation phrase in a reply, or null when it reads as Spanish. */
export function translationesePhrase(text: string): string | null {
  if (!text.trim()) return null;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
  for (const entry of translationesePatterns) {
    if (entry.pattern.test(normalized)) return entry.phrase;
  }
  return null;
}

// Both the English and the Spanish name of each target language are accepted so
// a Spanish user asking "¿Puedes responder en inglés?" is understood. Accents
// are already stripped by normalization, so the Spanish names are unaccented.
const responseLanguages = [
  "english", "chinese", "mandarin", "french", "german", "japanese", "korean", "italian", "portuguese",
  "ingles", "chino", "frances", "aleman", "japones", "coreano", "italiano", "portugues",
].join("|");

const languageRequestPatterns: readonly RegExp[] = [
  // A verb of expression plus the target language, e.g. "responde en inglés".
  // The verb list carries the inflected and reflexive forms so a plain
  // "¿Puedes responder en inglés?" is recognised as a request.
  new RegExp(
    `\\b(?:write|answer|respond|reply|speak|explain|say|tell|talk|translate|habl(?:a|ame|ar)|respond(?:e|eme|er)|contest(?:a|ame|ar)|escrib(?:e|eme|ir)|explic(?:a|ame|ar)|traduc(?:e|eme|ir)|dime|dilo)(?:\\s+me)?(?:\\s+back)?\\s+(?:in|en)\\s+(?:${responseLanguages})\\b`,
    "u",
  ),
  // An explicit switch, e.g. "cambia a inglés" or "switch to English".
  new RegExp(
    `\\b(?:switch|change|cambia|cambiar|pasate|pasemos)\\s+(?:to|al?\\s+)?(?:${responseLanguages}|spanish|espanol)\\b`,
    "u",
  ),
  /\bno\s+(?:me\s+)?(?:hables|respondas|contestes|escribas)\s+en\s+espanol\b/u,
  /(?:用|说|讲|写)\s*(?:中文|汉语|普通话|英文|英语)/u,
  /(?:中文|汉语|英文|英语)\s*(?:回复|回答|说|写|解释)/u,
];

/**
 * True only when the user explicitly asked to be answered in a language other
 * than Spanish. Spanish is the default; the shipped rule is that the character
 * switches language when the user asks for it and not spontaneously.
 */
export function requestedNonSpanishLanguage(userMessage: string): boolean {
  if (!userMessage.trim()) return false;
  const normalized = userMessage
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/gu, " ")
    .trim();
  // Han requests keep their characters through normalization, so one pass over
  // the original message covers both the Chinese phrase patterns and the rest.
  return languageRequestPatterns.some(
    (pattern) => pattern.test(normalized) || pattern.test(userMessage),
  );
}
