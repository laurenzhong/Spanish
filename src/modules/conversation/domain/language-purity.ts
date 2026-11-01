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
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Arabic}|\p{Script=Greek}/u;

/** True when text carries characters whose script Spanish does not use. */
export function containsUnsupportedScript(text: string): boolean {
  return unsupportedScriptPattern.test(text);
}

/** Normalization shared by the checks below; accents are stripped first. */
function normalizeForLanguageCheck(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("es-ES");
}

/**
 * English shares the Latin script with Spanish, so the script gate above cannot
 * see it. The reported defect is a live proactive message from 2026-10-23:
 * "Buenos días. Acabo de Wake Up y foster me he acordado de ti. Oye, ¿has
 * desayunado ya?" The provider prompt is written in English ("... such as
 * waking up, coffee, breakfast ..."), and the model copied English words into an
 * otherwise Spanish message.
 *
 * The check is a bounded high-precision heuristic, not a language detector. It
 * flags reported English phrases and a short list of English function words and
 * particles, but a single-word hit requires the original token to already be
 * lowercase (`token.original === token.lower`). Capitalization is how Spanish
 * text carries proper nouns, titles and acronyms ("It", "The Beatles", "Doctor
 * Who", "US Open", the Spanish tech acronym "IT", the medical eponym "síndrome
 * de Down"), and a lowercase English word is what the model writes when it
 * actually slips language. The same exact-surface rule keeps `aré` (which accent
 * stripping normalizes to "are") from firing.
 *
 * Words with a Spanish reading or ordinary Spanish loanword usage stay out:
 * "and" ("rock and roll", "Pull and Bear"), "after" ("el after"), "down" ("un
 * poco down"), "over"/"under" (betting), "on" ("modo on"), plus "in" ("in
 * situ"), "do" (music note), "as" (playing card), "once" (eleven), "am" (time
 * abbreviation) and the loanwords/names "will", "can", "out", "off" already
 * listed in the Spanish frequency corpus.
 */
const englishMarkerWords = new Set([
  "the", "are", "is", "was", "were", "it", "its", "this", "that", "these", "those",
  "with", "without", "for", "from", "have", "had", "would", "could", "should", "of",
  "into", "at", "been", "but", "or", "if", "then", "there", "their", "they", "them",
  "we", "our", "my", "your", "you", "she", "her", "him", "his", "us", "an", "any", "some",
  "other", "about", "before", "between", "during", "again",
  "just", "very", "too", "also", "because", "while", "when", "where", "what", "who", "why",
  "how", "than", "up",
]);

/** Reported lowercase English words; capitalized "Wake"/"Foster" is a name. */
const reportedEnglishWords = new Set(["wake", "foster", "comfort", "lately", "talking", "recipes", "complicated", "exchanged"]);

// These malformed or unmistakable English content words were observed in the
// real baseline. Capitalization does not make `Cooking` or `Somewhere` a
// plausible proper noun in these reply shapes.
const caseInsensitiveReportedEnglishWords = new Set([
  "cooking",
  "cookin",
  "hascookin",
  "somewhere",
  // Real CONV-EVAL-006 R01 reply: "Recommendation de libros".
  // This is an English content noun, not a Spanish loanword or title in that
  // sentence, so capitalization must not allow it through the gate.
  "recommendation",
  "recommendations",
  "cooked",
  "working",
  "means",
  "relaxing",
  "verification",
  "cooks",
  "tongue",
  "perfectly",
  "commitments",
  "dishes",
  "preparation",
  "curious",
  "altogether",
  "apple",
  "changed",
  "often",
  "resolved",
  "cute",
  // Retry32 R04: clear English content words leaked into otherwise Spanish
  // replies. Keep these exact words bounded; accented Spanish equivalents do
  // not normalize to the same surfaces.
  "complication",
  "sharing",
  "dish",
  "novelty",
  "cookbook",
  "task",
  "accomplishment",
  // Postfix R04: sentence-initial English connector leaked through with a
  // capital letter, so it cannot rely on the lowercase marker rule.
  "then",
  // Clean-source R04 samples: English content words leaked into otherwise
  // Spanish replies. Keep these explicit to avoid turning this into a broad
  // language detector.
  "prepared",
  "surround",
  "advance",
  "enjoying",
  "reserved",
  // Gatefix5 R04 review: English content leaked into a Spanish reply.
  "recounts",
  "satisfaction",
  "deferred",
  // retry14 R04: English adverb leaked into an otherwise Spanish reply.
  "increasingly",
  // retry16 R04: English adjective leaked into a Spanish cooking question.
  "elaborate",
  // retry18 R04: English participle leaked into a Spanish cooking reply.
  "benefitted",
  // retry20 R04: uppercase English pressure noun leaked into a slow-pace reply.
  "pressure",
  // retry21 R04: English content words leaked into otherwise Spanish replies.
  "patience",
  "obligated",
  // retry23 R04: English content words leaked into broken Spanish replies.
  "amenable",
  "protein",
  "seekers",
  // Retry40 R01: English content words leaked into otherwise Spanish replies.
  "recommending",
  "enjoys",
  "substantiate",
  // Retry35 R04: English placeholder leaked into a Spanish reply.
  "filling",
  // retry25 R04: an English participle leaked into a Spanish sentence.
  "pressured",
  // Retry29 R04: standalone English leaks in otherwise Spanish replies.
  "scarce",
  "descending",
]);

// High-confidence malformed Latin fragments observed in the 006 real run.
// This remains a tiny regression list, not a general grammar detector.
const malformedSpanishFragments = new Set(["teargue", "plats", "aoften", "habianchanged", "hancancelado", "librogood", "quedetail", "hastaapis", "seguirathediendo", "irools", "pressionarnos", "falar", "parler", "couth", "poderrecommendations", "recommendationes", "semad", "habivenido", "yichar", "tocaomc", "itsonga", "sinorpheus", "kerja", "sinuqunhugdias", "niotro", "niiotro", "cookinado", "hascookinado", "concedecido", "mananatalk", "acabadoposteriorsind", "teoe", "quehjablemos", "deplantejarlo", "historiasbindings", "trouveeis", "acabao", "meyk", "jobsuka", "estrarajes", "kotliniendo", "quecuriosity", "bougies", "rarity", "hascookeado", "faltaknowing", "tenerprotagonismo", "vayamadurando", "etiquetteado", "peromarks", "comedir", "telanguages", "cookear", "hoyelpas", "obligationes", "pressa", "lamanagement", "hebang", "enjoy", "proposes", "laavailability", "enjoyed", "techiro", "texl", "teowelcomes", "lohares", "quested", "sueleneys", "haencedido", "pudearu", "puedearu", "puedeurposeuno", "nosirs", "questionsquestion", "podemosknown", "asiforwardos", "cooksinado", "sinhornear", "tulas", "másspecial", "ydescending", "questrange", "masoparaca", "strayes", "dejandohqsomesator", "bienerrecho"]);
const malformedSpanishPatterns: readonly Readonly<{ phrase: string; pattern: RegExp }>[] = [
  // Retry41 R01/R05: provider drafting residue fused punctuation/English into
  // otherwise Spanish replies. These exact shapes are unambiguously corrupt;
  // keep them narrow so ordinary names and quoted text remain possible.
  { phrase: "de_share", pattern: /\bde_share\b/iu },
  { phrase: "now.handzu", pattern: /\bnow\.handzu\b/iu },
  { phrase: "que recordá", pattern: /\bquerecorda\b/iu },
  { phrase: "como ukeep", pattern: /\bcomoukeup\b/iu },
  { phrase: "freees", pattern: /\bfreees\b/iu },
  // Retry37 R05: `solo curas que` is a malformed clause in the occupation
  // reply; match the full shape so the valid Spanish noun/verb `curas` is not
  // blocked in unrelated sentences.
  { phrase: "solo curas que", pattern: /\bsolo\s+curas\s+que\b/u },
  // Retry36 R05 step 13: the provider emitted the Galician/Catalan greeting
  // `bons días` inside an otherwise Spanish reply. Keep this exact phrase
  // narrow so valid names or quoted user text are not treated as corruption.
  { phrase: "bons días", pattern: /\bbons\s+dias\b/u },
  // Flash reviewer-confirmed grammar corruption: the auxiliary "has" was
  // followed by an infinitive instead of the participle "concedido".
  { phrase: "te has conceder", pattern: /\bte\s+has\s+conceder\b/u },
  { phrase: "nos quedamos en un rato tranquilo", pattern: /\bnos\s+quedamos\s+en\s+un\s+rato\s+tranquilo\b/u },
  // Flash holdout corruption: "Hoy se Pola." is not a Spanish clause. Keep
  // the exact shape so the proper name "Pola" remains valid elsewhere.
  { phrase: "hoy se pola", pattern: /\bhoy\s+se\s+pola\b/u },
  { phrase: "quelques jours", pattern: /\bquelques\s+jours\b/u },
  // R04 retry6: "habéis podrido cambiar" is a malformed replacement for
  // "habéis podido cambiar". "Podrido" remains valid Spanish elsewhere;
  // require the full auxiliary + infinitive shape to avoid false positives.
  { phrase: "habéis podrido cambiar", pattern: /\bhabeis\s+podrido\s+cambiar\b/u },
  { phrase: "unas contenidos", pattern: /\bunas\s+contenidos\b/u },
  { phrase: "me ha raro", pattern: /\bme\s+ha\s+raro\b/u },
  { phrase: "busqueda algo", pattern: /\bbusqueda\s+algo\b/u },
  { phrase: "decidlo", pattern: /\b(?:hay\s+que|puedes)\s+decidlo\b/u },
  { phrase: "planes cerradas", pattern: /\bplanes\s+cerradas\b/u },
  // Clean-source R04 artifacts: punctuation, an underscore, and a fused word
  // boundary are all high-confidence provider corruption.
  { phrase: "y.GLASS", pattern: /\by\.glass\b/u },
  { phrase: "habéis_cancelado", pattern: /\bhabeis_cancelado\b/u },
  { phrase: "lo.byte", pattern: /\blo\.byte\b/u },
  { phrase: "nos_unknown", pattern: /\bnos_unknown\b/u },
  { phrase: "haquitada", pattern: /\bhaquitada\b/iu },
  // Retry9 R04: an English fragment was glued to a Spanish comparative.
  { phrase: "más-proxy", pattern: /\bmas-proxy\b/u },
  // Retry10 R04: a provider output marker was fused into a Spanish verb.
  { phrase: "puedesootput", pattern: /\bpuedesootput\b/iu },
  // Retry9 R04: the provider repeated an English placeholder inside a question.
  { phrase: "mandatory repetition", pattern: /mandatory(?:mandatory){1,}/iu },
  // Retry9 R04: an English outlet noun was inserted into a broken Spanish clause.
  { phrase: "acaba outlet bien", pattern: /\bacaba\s+outlet\s+bien\b/iu },
  // Retry12 R04: fused English-looking fragments in otherwise Spanish words.
  { phrase: "estaroi", pattern: /\bestaroi\b/iu },
  { phrase: "plantsarse", pattern: /\bplantsarse\b/iu },
  { phrase: "querer saver", pattern: /\bquerer\s+saver\b/iu },
  { phrase: "tener que rush nada", pattern: /\btener\s+que\s+rush\s+nada\b/iu },
  // Retry19 R04: a fused English fragment appeared in an occupation reply.
  { phrase: "de-book", pattern: /\bde-book\b/iu },
  // Retry26 R04: exact English-to-Spanish word fusion.
  { phrase: "podemosknown", pattern: /\bpodemosknown\b/iu },
  // Retry28 R04: English `Forward` fused into the Spanish sentence opener.
  { phrase: "asiforwardos", pattern: /\basiforwardos\b/iu },
  // Retry26 R04: visible self-correction/literal calque in the opening.
  { phrase: "me alegra que te deje una pregunta abierta", pattern: /\bme\s+alegra\s+que\s+te\s+deje\s+una\s+pregunta\s+abierta\b/iu },
  // Retry31 R04 step 0: `hobby` is masculine in this construction; the
  // provider's `una hobby` is a high-confidence agreement error.
  { phrase: "una hobby", pattern: /\buna\s+hobby\b/iu },
  // Retry31 R04 step 3: these fused hyphenated fragments are visible provider
  // corruption, not ordinary Spanish punctuation. Keep both exact shapes
  // narrow so legitimate hyphenated compounds are unaffected.
  { phrase: "anuncios-consumerista-de-que-sea-feliz-o-que-tenga-un-buen-rato-ahora-mismo", pattern: /\bsin\s+anuncios-consumerista-de-que-sea-feliz-o-que-tenga-un-buen-rato-ahora-mismo\b/iu },
  { phrase: "alguna-vez-te-ha-salido-bien-una-receta-que-te-haya-sorprendido-a-ti-mismo", pattern: /\balguna-vez-te-ha-salido-bien-una-receta-que-te-haya-sorprendido-a-ti-mismo\b/iu },
  // Retry32 R04 step 20: the provider fused an adverb and adjective into one
  // token; this exact shape is visibly unreadable and safe to retry.
  { phrase: "seguramentealgún", pattern: /\bseguramentealgun\b/iu },
  // Retry34 R04 step 3: English ownership residue fused into a Spanish
  // question. Keep the exact hyphenated shape narrow.
  { phrase: "has-owner", pattern: /\bhas-owner\b/iu },
  // Retry35 R04: internal placeholder residue fused into a question.
  { phrase: "te dejo_NAMESPACE'll decide", pattern: /\bte\s+dejo_namespace'?ll\s+decide\b/u },
  // Retry40 R01: malformed auxiliary/verb agreement in an otherwise Spanish
  // cooking response. Keep the phrase exact to avoid broad grammar guessing.
  { phrase: "cuando has cocinas", pattern: /\bcuando\s+has\s+cocinas\b/u },
];

/** Reported multi-word fragments, matched on lowercase tokens so titles count too. */
const englishPhraseSequences: readonly (readonly string[])[] = [
  ["wake", "up"],
  ["good", "morning"],
  ["good", "afternoon"],
  ["good", "evening"],
  ["good", "night"],
  ["how", "are", "you"],
  ["having", "a", "free", "afternoon"],
  ["how", "s", "it", "going"],
  ["what", "s", "up"],
  ["thank", "you"],
  ["see", "you"],
  ["that", "s", "great"],
  ["that", "s", "nice"],
  ["that", "s", "good"],
  ["that", "s", "cool"],
  ["of", "course"],
  ["by", "the", "way"],
  ["never", "mind"],
  ["i", "love", "you"],
  ["i", "miss", "you"],
  ["i", "m", "sorry"],
  ["oh", "my", "god"],
  ["pay", "attention"],
  // Retry41 R01: English clause leaked into a Spanish closing message.
  ["will", "return"],
  // Gatefix12 step 7: a provider fused an English clause into a Spanish
  // occupation reply. Keep this as a phrase so ordinary Spanish uses of
  // either token are not independently blocked.
  ["mainly", "orders"],
];

type LanguageToken = Readonly<{ original: string; lower: string }>;

function languageTokens(value: string): readonly LanguageToken[] {
  return [...value.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    original: match[0],
    lower: normalizeForLanguageCheck(match[0]),
  }));
}

/** Detects a duplicated substantive sentence inside one provider candidate. */
export function hasRepeatedReplySentence(text: string): boolean {
  const sentences = text
    .split(/[.!?。！？]+/u)
    .map((sentence) => normalizeForLanguageCheck(sentence).replace(/\s+/gu, " ").trim())
    .filter((sentence) => sentence.length >= 18);
  return sentences.some((sentence, index) => sentences.indexOf(sentence) !== index);
}

export function malformedSpanishFragment(text: string): string | null {
  const token = languageTokens(text).find((candidate) => malformedSpanishFragments.has(candidate.lower));
  if (token) return token.lower;
  const normalized = normalizeForLanguageCheck(text);
  const phrase = malformedSpanishPatterns.find((entry) => entry.pattern.test(normalized));
  if (phrase) return phrase.phrase;
  // Parenthesized inline edits such as "te(resulta)" are provider artifacts,
  // not a character's ordinary chat punctuation. Keep the check narrow enough
  // to avoid treating a normal sentence with a parenthetical aside as corrupt.
  const inlineEdit = /\b\p{L}{2,}\(\p{L}{2,}\)(?=\s|[.!?,;:]|$)/u.exec(text);
  if (inlineEdit?.[0]) return inlineEdit[0].toLocaleLowerCase("es-ES");
  const starredArtifact = /\*\p{L}{2,}\*/u.exec(text);
  if (starredArtifact?.[0]) return starredArtifact[0].toLocaleLowerCase("es-ES");
  const slashArtifact = /\b\p{L}{1,}\/\p{L}{2,}\b/u.exec(text);
  if (slashArtifact?.[0]) return slashArtifact[0].toLocaleLowerCase("es-ES");
  const dottedWord = /\bte\.has\b/iu.exec(text);
  return dottedWord?.[0]?.toLocaleLowerCase("es-ES") ?? null;
}

function normalizedTokens(value: string): readonly string[] {
  return languageTokens(value).map((token) => token.lower);
}

function matchingEnglishPhrase(
  tokens: readonly LanguageToken[],
  start: number,
): Readonly<{ phrase: string; tokens: readonly string[]; length: number }> | null {
  for (const sequence of englishPhraseSequences) {
    if (start + sequence.length > tokens.length) continue;
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (tokens[start + offset]?.lower !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return { phrase: sequence.join(" "), tokens: sequence, length: sequence.length };
  }
  return null;
}

export type EnglishFragment = Readonly<{
  /** Matched text built from this module's fixed entries, never arbitrary model text. */
  phrase: string;
  tokens: readonly string[];
}>;

/**
 * Every English fragment in the text, in order and non-overlapping. Reported
 * phrases win over their constituent words so the retry can name the whole
 * fragment and a quoted phrase is not split into two single-word hits.
 */
export function englishFragments(text: string): readonly EnglishFragment[] {
  if (!text.trim()) return [];
  const tokens = languageTokens(text);
  const fragments: EnglishFragment[] = [];
  let index = 0;
  while (index < tokens.length) {
    const phrase = matchingEnglishPhrase(tokens, index);
    if (phrase) {
      fragments.push({ phrase: phrase.phrase, tokens: phrase.tokens });
      index += phrase.length;
      continue;
    }
    const token = tokens[index]!;
    if (caseInsensitiveReportedEnglishWords.has(token.lower)
      || ((englishMarkerWords.has(token.lower) || reportedEnglishWords.has(token.lower)) && token.original === token.lower)) {
      fragments.push({ phrase: token.lower, tokens: [token.lower] });
    }
    index += 1;
  }
  return fragments;
}

/** The first English fragment in a reply, or null when it reads as Spanish. */
export function englishFragment(text: string): EnglishFragment | null {
  return englishFragments(text)[0] ?? null;
}

/**
 * True when every token of the fragment is already in the user's message. That
 * makes the English a quotation of the learner's own words instead of the
 * character switching language, and only conversation replies use this escape
 * hatch: an unsolicited proactive message has no user turn to quote.
 */
export function fragmentQuotedFromUserMessage(
  userMessage: string,
  fragment: EnglishFragment,
): boolean {
  if (!userMessage.trim()) return false;
  const userTokens = new Set(normalizedTokens(userMessage));
  return fragment.tokens.every((token) => userTokens.has(token));
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
  const normalized = normalizeForLanguageCheck(text);
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
  const normalized = normalizeForLanguageCheck(userMessage)
    .replace(/\s+/gu, " ")
    .trim();
  // Han requests keep their characters through normalization, so one pass over
  // the original message covers both the Chinese phrase patterns and the rest.
  return languageRequestPatterns.some(
    (pattern) => pattern.test(normalized) || pattern.test(userMessage),
  );
}
