export function normalizeOccupationText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/gu, "").toLocaleLowerCase("es-ES").replace(/\s+/gu, " ").trim();
}

const words = (value: string) => normalizeOccupationText(value).match(/[\p{L}\p{N}]{4,}/gu) ?? [];
const withoutQuotes = (value: string) => value.replace(/«[^»]*»|“[^”]*”|"[^"]*"|'[^']*'/gu, " ");
// Sentence and clause boundaries determine which assertion a negation belongs to.
const clauses = (value: string) => value.match(/[^.!?;:,\n]+[.!?;:,]?/gu) ?? [];

function asksAboutOccupation(userMessage: string, occupation: string): boolean {
  const factWords = new Set(words(occupation));
  return clauses(withoutQuotes(userMessage)).some(raw => {
    const clause = normalizeOccupationText(raw);
    const overlap = new Set(words(clause).filter(word => factWords.has(word))).size;
    const occupationQuestion = /\b(?:tu (?:trabajo|profesion|ocupacion)|a que te dedicas|en que trabajas)\b/u.test(clause);
    const clarifying = /\b(?:pensaba|creia|aclara(?:r|s|me)?|aclaracion|no (?:entiendo|entendi)|entendido (?:bien|mal)|te refieres)\b/u.test(clause);
    const asksCharacter = /\b(?:tu|te|sigues|continuas|trabajas)\b/u.test(clause);
    return (occupationQuestion || overlap >= 2) && (clarifying || (/\?/u.test(raw) && (asksCharacter || occupationQuestion)));
  });
}

function assertsOwnOccupation(raw: string, occupation: string): boolean {
  const clause = normalizeOccupationText(raw);
  const index = clause.indexOf(occupation);
  if (index < 0) return false;
  const attribution = clause.slice(0, index);
  // Reject denial, uncertainty, quotation-like reporting, and hypothetical claims
  // within this clause, rather than rejecting an unrelated "No trabajo ..." later.
  if (/\b(?:no|nunca|jamas|tampoco|antes|quizas|quiza|ojala|supongo|creo|pienso|imagino|podria|deberia|trabajaria|fuera|trabajara|dijiste|dije|dijo|dices|dice|gustaria)\b/u.test(attribution)
    || /\bsi\s+/u.test(raw.toLocaleLowerCase("es-ES"))) return false;
  if (/\b(?:tu|usted|ella|ellos|ellas|su)\b/u.test(attribution) || /(?:^|[^\p{L}])él(?=$|[^\p{L}])/iu.test(raw)) return false;
  // A bounded grammar of present work/continuation predicates, independent of
  // exact sentence openings and punctuation. A pronoun or arbitrary -o word
  // cannot turn interest, past work or a quote into a present occupation claim.
  return /\b(?:trabajo|sigo(?: trabajando| dedicandome)?|continuo(?: trabajando| dedicandome)?|estoy trabajando|me (?:dedico|centro|ocupo))(?:\s+[\p{L}]+mente)*\s+(?:en|a|con)\s+(?:(?:el|la|los|las)\s+)?$/u.test(attribution)
    || /\bmi (?:trabajo|profesion|ocupacion)\s+(?:es|consiste)\s+(?:en|el|la|los|las)\s*$/u.test(attribution);
}

/** Bounded clause grammar for repeat comparison, not a general Spanish entailment or fact validator. */
export function clarifiedCanonicalOccupation(input: Readonly<{
  authoredOccupation: string | undefined;
  userMessage: string;
  reply: string;
}>): string | null {
  const authored = normalizeOccupationText(input.authoredOccupation ?? "");
  const occupation = authored.replace(/^(?:trabaja en|se dedica a)\s+/u, "").replace(/[.!]+$/u, "");
  if (authored === occupation || words(occupation).length < 4 || !asksAboutOccupation(input.userMessage, occupation)) return null;
  const reply = withoutQuotes(input.reply);
  // Do not use an affirmative fragment to exempt a quoted or contradicted copy.
  const occurrences = (value: string) => normalizeOccupationText(value).split(occupation).length - 1;
  if (occurrences(reply) !== occurrences(input.reply)) return null;
  // A comma does not end a conditional's scope: "Si me contratan, trabajo en ..."
  // must not become an affirmative job claim when its clauses are separated.
  if (reply.split(/[.!?;\n]/u).some(sentence => normalizeOccupationText(sentence).includes(occupation)
    && /\bsi\s+/u.test(sentence.toLocaleLowerCase("es-ES")))) return null;
  const replyClauses = clauses(reply.replace(/\s+(?:pero|sino que|y)\s+(?=(?:yo|tú|usted|ella|él|no|nunca|me|trabajo|sigo|continúo|ahora)\b)/giu, "; "));
  const factWords = new Set(words(occupation));
  if (replyClauses.some(raw => {
    const clause = normalizeOccupationText(raw);
    if (clause.includes(occupation) || /\b(?:no|nunca|tampoco)\b/u.test(clause)) return false;
    if (/\b(?:he cambiado|he dejado|ahora (?:trabajo|soy))\b/u.test(clause)) return true;
    // An extra affirmative first-person job cannot borrow the canon exception:
    // "trabajo en una librería y me dedico a <canon>" invents a second job.
    // Subject anchoring keeps "tú trabajas ..." and another person's job separate.
    const otherJob = /^(?:yo\s+)?(?:tambien\s+)?(?:trabajo en|me dedico a)\s+(.+)/u.exec(clause)?.[1];
    return otherJob !== undefined && new Set(words(otherJob).filter(word => factWords.has(word))).size < 2;
  })) return null;
  const assertions = replyClauses.filter(clause => normalizeOccupationText(clause).includes(occupation));
  return assertions.length > 0 && assertions.every(clause => assertsOwnOccupation(clause, occupation)) ? occupation : null;
}
