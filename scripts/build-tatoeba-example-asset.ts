/**
 * Build the Tatoeba example asset: one Spanish example with a Chinese translation
 * for each word on the shelf.
 *
 * Why an asset and not a live call. Tatoeba's API answers a word at a time and this
 * shelf has ~7.9k words, so a live lookup would put an external request — with its
 * latency, its rate limits and its outages — inside opening a word. It would also
 * make attribution and removal impossible to guarantee, because the sentences would
 * never have been recorded anywhere we control. `AGENTS.md` §8 wants third-party
 * content validated, stored with its source and licence, and removable, so the
 * sentences are fetched here, validated, written with their attribution, and read
 * from disk at runtime.
 *
 * What is stored per word:
 * - the Spanish sentence, its id, and its licence and author from Tatoeba;
 * - the Chinese translation, with its own id, licence and author — the two carry
 *   separate attribution and both are required by CC BY 2.0 FR;
 * - `matchedForm`: the exact token from the sentence that made it count as an example
 *   of this word (`haber` → `había`), so a reviewer checks the match instead of
 *   trusting it. `application/tatoeba-examples.ts` reads it (null for records written
 *   before the field existed) and the panel shows it beside the sentence;
 * - `tags` on the pair, so the UI never has to re-derive why it was accepted.
 *
 * Two filters the API cannot do for us, both found by measurement
 * (`docs/references/2026-10-12-tatoeba-as-example-source.md` §4):
 * 1. `q=` matches Tatoeba's **stem bucket**, not the word. `q=haber` returns `había`,
 *    `habéis`, `haberlo` — the recall we want — but the same bucket also holds `habas`
 *    (a different word: `q=haber` and `q=habas` both report `paging.total=529`), and
 *    the bucket never contains a form with a different stem (`he`, `hubiera` for
 *    `haber`; `voy`, `fui` for `ir`). `matchedLemmaForm()` below is the precision half:
 *    a sentence is kept only when it contains a token that really is an inflected,
 *    clitic-bearing or plural form of the word, and its blind spots are documented
 *    where the rule lives and in §4.3 of that reference.
 * 2. Chinese translations mix Simplified and Traditional. `script` is not always set,
 *    so an unmarked translation is kept only when it contains no Traditional-only
 *    characters; otherwise the word waits for a `Hans`-marked translation.
 *
 * Resumable on purpose: 7.9k requests take minutes, and a partial run must be able to
 * continue rather than start over. Every word fetched in an earlier run is reused,
 * except the two cases below that are re-asked on purpose.
 *
 * Usage:
 *   npx tsx scripts/build-tatoeba-example-asset.ts            # fetch what is missing
 *   npx tsx scripts/build-tatoeba-example-asset.ts --limit 50 # small run, for review
 *   RESUME=0 npx tsx scripts/build-tatoeba-example-asset.ts   # ignore the existing file
 *   RETRY_EMPTY=1 npx tsx scripts/build-tatoeba-example-asset.ts  # also re-ask words
 *                                                                # that came back empty
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

config({ quiet: true });

import { contentFrequencyWords } from "@/src/modules/lexicon-corpus/domain/frequency-word-list";
import { normalizeSpanishSurface } from "@/src/modules/lexicon-corpus/domain/spanish-token";
import { parseTatoebaAudio, type TatoebaAudio } from "@/src/modules/lexicon-corpus/domain/tatoeba-audio";

const outputPath = process.env.TATOEBA_ASSET_PATH
  ?? path.join(process.cwd(), "content", "word-lists", "es-examples-tatoeba-v1.json");
const limit = Number(process.env.TATOEBA_LIMIT ?? "0");
const resume = process.env.RESUME !== "0";
/** How many examples to keep per word. Two is enough to show a word in two frames. */
const examplesPerWord = 2;
/**
 * Also re-ask words whose earlier run found nothing (`examples: []`). Off by default,
 * because a normal resume must not spend a request on a word Tatoeba already answered
 * for; on when the *rule* changed and "nothing found" may have been the old rule's
 * answer rather than Tatoeba's (that is exactly the `haber` bug: 229 words were
 * recorded as empty that do have sentences).
 */
const retryEmpty = process.env.RETRY_EMPTY === "1";

type Example = Readonly<{
  audio?: TatoebaAudio | null;
  text: string;
  translation: string;
  /** CC BY 2.0 FR requires attribution for both, so both are stored. */
  sentenceId: number;
  sentenceLicense: string | null;
  sentenceOwner: string | null;
  translationId: number;
  translationLicense: string | null;
  translationOwner: string | null;
  isDirect: boolean;
  /** The token from `text` that matched the word, verbatim (`haber` → `había`). */
  matchedForm: string;
  /** Why this pair was accepted, for the UI to state and for a reviewer to check. */
  tags: readonly string[];
}>;

type WordEntry = Readonly<{ word: string; examples: readonly Example[] }>;

type Asset = Readonly<{
  source: "tatoeba";
  sourceUrl: string;
  license: string;
  attributionRequired: true;
  generatedAt: string;
  /** Words looked up, and how many of them produced an example. */
  wordCount: number;
  exampleCount: number;
  examples: Readonly<Record<string, WordEntry>>;
}>;

/* -------------------------------------------------------------------------- */
/* The lemma rule                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Is `token` a form of `word`, and if so which token matched?
 *
 * Why this exists at all. The first version of this script accepted a sentence only
 * when the *bare* word appeared as a whole token, so `haber` matched `Quiero haber`
 * and nothing else — `¿Habías llamado?`, `Habían dos tortas.`, `Lamento haber
 * mentido.` and `Recuerdo haberlo visto.` were all rejected. Tatoeba has 529
 * sentences in `haber`'s bucket; the shelf showed zero. On a frequency shelf almost
 * every verb appears only in inflected form, so the rule has to match the *lemma*.
 *
 * The rule, in order. `token` is accent-folded except where noted; `word` is the
 * shelf word (the citation form).
 *
 * 1. **Identical** — the token is the word. `haber` matches `haber`.
 * 2. **Plural of a nominal** — `+s` after a vowel, `+es` after a consonant, `-z` →
 *    `-ces`. `casas` is accepted for `casa`, `haberes` for `haber`, `lápices` for
 *    `lápiz`. This is why `casas` counts for `casa`: it is the same lexeme.
 * 3. **Regular verb form** — only when the word is an infinitive (`-ar`/`-er`/`-ir`)
 *    and its stem is at least three letters. The token must be `stem + ending` for an
 *    ending in the table for that conjugation, optionally followed by one or two
 *    attached pronouns (`haberlo`, `habérselo`, `casarse`).
 * 4. **Reflexive infinitive** — when the shelf word itself ends in `-se` (`quedarse`,
 *    `sentirse`, both separate shelf entries from `quedar`/`sentir`), forms of the
 *    base verb are accepted only with a reflexive marker: attached (`quedarse`,
 *    `quedándome`) or as the immediately preceding token (`me quedé`, `se queda`).
 *    Otherwise a sentence about plain `quedar` would be shown as an example of
 *    `quedarse`. The converse asymmetry is deliberate and documented: the base entry
 *    `quedar` accepts `quedarse` too, because the word is present in the sentence —
 *    the extra condition exists to stop `quedarse` claiming non-reflexive uses.
 *
 * Boundaries, so this is not a loose prefix match:
 * - The remainder must be a **whole ending** from the table, not any suffix. `casaron`
 *   is `cas` + `aron` (in the table) and counts; `sabio` is `sab` + `io`, and `io` is
 *   not the ending — the ending is the accented `ió`, so a stem-mate that is not a real
 *   form is rejected.
 * - The `-a/-as/-amos/-áis/-an` present-subjunctive block of `-er`/`-ir` verbs is
 *   **excluded**: it is the one ending group whose folded spelling collides with the
 *   plural of very common nouns. Keeping it would accept `habas` for `haber`, which is
 *   a different word — the exact failure this rule must not have. The cost is real and
 *   accepted: `comas`, `vendas`, `vivas` are not matched for `comer`, `vender`, `vivir`
 *   (those verbs still match `come`, `comía`, `comido`, `comiendo`, …).
 * - Stems shorter than three letters are **excluded** from the verb path, because the
 *   table would then accept ordinary non-verb words: `ver` + `ía` = `vía`,
 *   `dar` + `e` = `de`, `oler` + `a` = `ola`, `ser` + `ed` = `sed`. Those shelf words
 *   keep rule 1 and 2 only.
 * - Endings that standard Spanish writes with an accent are matched **with** the
 *   accent (`tenía`, `sabía`, `comió`, `vivís`). Folding them would accept `tenia`
 *   (tapeworm) for `tener`, `sabia`/`sabio` (wise) for `saber`, `podio` (podium) for
 *   `poder`. The corpus is accented (`q=habia` returns `paging.total=0`, `q=había`
 *   returns 529), so this costs no recall. Attached pronouns move the stress, so the
 *   clitic path compares folded (`habérselo` still matches `haber`).
 *
 * Known blind spots — deliberately not covered, not pretended:
 * - **Irregular stems.** `haber` → `he`, `has`, `ha`, `hemos`, `han`, `hube`, `hubo`,
 *   `hubiera`; `ir` → `voy`, `fui`, `vamos`; `ser` → `soy`, `era`; `poder` → `puedo`,
 *   `pudo`; `querer` → `quiero`; `saber` → `sé`. No prefix rule can reach a stem that
 *   changed, and a local table of irregular forms would not help either: those
 *   sentences are not even returned. `q=` matches a stem bucket, and the bucket for
 *   `haber` is `hab` while `hubiera` sits in `hub` (`q=hubiera` → 94) and `hemos` in
 *   its own (`q=hemos` → 75). Reaching them needs extra per-form queries, which this
 *   script does not do.
 * - **Stem-changing verbs in the present** (`puedo`, `quiero`, `tiene`, `siento`) and
 *   irregular gerunds/participles (`diciendo`, `dicho`, `hecho`) — same reason.
 * - **Homographs of the same stem** are accepted because the rule does not parse:
 *   `caso` matches `casar` (1sg `caso`) and also is a noun; `casa` matches `casar`
 *   (3sg) and is also the noun `casa`. A sentence is shown with its translation, so
 *   the reader can see which reading it is; the field records the form, not a claim
 *   about the reading.
 * - **Diphthong `ü` vs `u`** is folded (`pingüino` counts as `pinguino`), which is safe
 *   only because the unaccented spelling is not a different word; `ñ` is *not* folded
 *   for the opposite reason (see `foldLemmaForm`).
 * - **Reflexive vs impersonal `se`** are not distinguished: `Se venden casas.` is
 *   accepted for `venderse`.
 */
export function matchedLemmaForm(sentence: string, word: string): string | null {
  const lemma = foldLemmaForm(word);
  if (!lemma) return null;
  const reflexiveBase = reflexiveInfinitiveBase(lemma);
  const tokens = sentenceTokens(sentence);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const previous = index > 0 ? tokens[index - 1]!.folded : null;
    if (isLemmaForm(token, lemma, reflexiveBase, previous)) return token.surface;
  }
  return null;
}

/** Sentence tokens in reading order; `folded` is the accent-folded form of `surface`. */
function sentenceTokens(sentence: string): readonly Readonly<{ surface: string; folded: string }>[] {
  return [...sentence.matchAll(/[\p{L}\p{M}]+/gu)].map((match) => {
    const surface = match[0];
    return { surface, folded: foldLemmaForm(surface) };
  });
}

/**
 * Accent folding that keeps `ñ` apart from `n`.
 *
 * `normalizeSpanishSurface` folds both to `n` — right for a dictionary key, wrong for
 * deciding whether a token is a form of a word: it would make `año` an example of `ano`
 * and `uña` one of `una`. `ñ` is a letter of the Spanish alphabet, not an `n` with a
 * diacritic, so the lemma rule folds everything except it. Like
 * `normalizeSpanishSurface`, this is length preserving for Spanish text, which is what
 * lets the ending table be indexed by character position. Exported so the verifier
 * classifies a match as exact or inflected with the same folding the rule used.
 */
export function foldLemmaForm(surface: string): string {
  return surface
    .normalize("NFD")
    .replace(/n\u0303/gu, "\u00f1")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es");
}

/**
 * One digit per base letter: `1` where the source carries a written accent. `había` →
 * `00010`. Exists so a stressed ending can be required to keep its accent without
 * comparing the strings twice.
 *
 * Only the acute accent and the diaeresis count. The tilde of `ñ` is part of the
 * letter, not a stress mark, and folding it away (as `normalizeSpanishSurface` does)
 * is not the same as losing an accent: `año` must not look like `ano` was stressed.
 */
function accentMask(surface: string): string {
  let mask = "";
  for (const character of surface.normalize("NFD")) {
    if (/[\u0301\u0308]/u.test(character)) mask = `${mask.slice(0, -1)}1`;
    else if (/\p{M}/u.test(character)) continue;
    else mask += "0";
  }
  return mask;
}

/**
 * Endings of regular verbs, written as Spanish writes them, grouped by infinitive
 * class. The present subjunctive of `-er`/`-ir` (`a, as, amos, áis, an`) is absent on
 * purpose — see the boundary note on `matchedLemmaForm`.
 */
const regularEndings: Readonly<Record<string, readonly string[]>> = {
  ar: [
    "o", "as", "a", "amos", "áis", "an",
    "é", "aste", "ó", "asteis", "aron",
    "aba", "abas", "ábamos", "abais", "aban",
    "é", "ás", "á", "emos", "éis", "án",
    "ía", "ías", "íamos", "íais", "ían",
    "e", "es", "emos", "éis", "en",
    "ara", "aras", "áramos", "arais", "aran",
    "ase", "ases", "ásemos", "aseis", "asen",
    "ar", "ando", "ado", "ada", "ados", "adas", "ad",
  ],
  er: [
    "o", "es", "e", "emos", "éis", "en",
    "í", "iste", "ió", "imos", "isteis", "ieron",
    "ía", "ías", "íamos", "íais", "ían",
    "é", "ás", "á", "emos", "éis", "án",
    "iera", "ieras", "iéramos", "ierais", "ieran",
    "iese", "ieses", "iésemos", "ieseis", "iesen",
    "er", "iendo", "ido", "ida", "idos", "idas", "ed",
  ],
  ir: [
    "o", "es", "e", "imos", "ís", "en",
    "í", "iste", "ió", "imos", "isteis", "ieron",
    "ía", "ías", "íamos", "íais", "ían",
    "é", "ás", "á", "emos", "éis", "án",
    "iera", "ieras", "iéramos", "ierais", "ieran",
    "iese", "ieses", "iésemos", "ieseis", "iesen",
    "ir", "iendo", "ido", "ida", "idos", "idas", "id",
  ],
};

/**
 * Pronoun attachment. One pronoun, or two: a dative (`me/te/se/nos/os`) plus an
 * accusative, and additionally `se` plus a dative (`quedársele`, `olvidársele`). The
 * other datives cannot be followed by a dative — Spanish allows one per verb — and
 * `le`/`les` never take an accusative in writing (`le lo` becomes `se lo`), so `lelo`
 * is not in the accepted set.
 */
const clitics = ["me", "te", "se", "lo", "la", "le", "los", "las", "les", "nos", "os"] as const;
const dativeClitics: readonly string[] = ["me", "te", "se", "nos", "os"];
const accusativeClitics: readonly string[] = ["lo", "la", "los", "las"];

function isCliticCluster(tail: string): boolean {
  if ((clitics as readonly string[]).includes(tail)) return true;
  return dativeClitics.some((dative) => {
    if (!tail.startsWith(dative)) return false;
    const rest = tail.slice(dative.length);
    return accusativeClitics.includes(rest) || (dative === "se" && (rest === "le" || rest === "les"));
  });
}

/** Reflexive form attached to the verb (`quedarse`, `quedándome`, `quedárselo`). */
function hasReflexiveClitic(tail: string): boolean {
  return ["me", "te", "se", "nos", "os", "selo", "sela", "selos", "selas", "sele", "seles"].includes(tail);
}

/** `quedarse` → `quedar`; `null` for every word that is not a reflexive infinitive. */
function reflexiveInfinitiveBase(lemma: string): string | null {
  if (!lemma.endsWith("se")) return null;
  const base = lemma.slice(0, -2);
  return /(ar|er|ir)$/u.test(base) ? base : null;
}

/**
 * Three letters is the shortest stem the ending table can be pointed at without
 * matching ordinary words: `ver` + `ía` = `vía`, `dar` + `e` = `de`. See the blind
 * spots on `matchedLemmaForm`.
 */
const minimumStemLength = 3;

/** `quedarse` → `quedar`'s regular forms, with every `-se` lemma's reflexive marker. */
function isVerbForm(surface: string, infinitive: string, requireReflexive: boolean): boolean {
  const endings = regularEndings[infinitive.slice(-2)];
  if (!endings) return false;
  const stem = foldLemmaForm(infinitive).slice(0, -2);
  if (stem.length < minimumStemLength) return false;
  const folded = foldLemmaForm(surface);
  if (!folded.startsWith(stem)) return false;
  const tail = surface.slice(stem.length);
  const foldedTail = folded.slice(stem.length);
  for (const ending of endings) {
    const foldedEnding = foldLemmaForm(ending);
    const stressed = accentMask(ending) !== "0".repeat(ending.length);
    // The form itself, ending as Spanish writes it (`tenía`, never `tenia`).
    if (foldedTail === foldedEnding && (!stressed || accentMask(tail) === accentMask(ending))) {
      if (!requireReflexive) return true;
    }
    // The form plus attached pronouns; stress moves onto an earlier syllable
    // (`haber` → `habérselo`), so the ending is compared folded here.
    if (foldedTail.startsWith(foldedEnding)) {
      const attached = foldedTail.slice(foldedEnding.length);
      if (attached.length > 0 && (requireReflexive ? hasReflexiveClitic(attached) : isCliticCluster(attached))) return true;
    }
  }
  return false;
}

function isPluralOf(token: string, lemma: string): boolean {
  const last = lemma.slice(-1);
  if (last === "z") return token === `${lemma.slice(0, -1)}ces`;
  if ("aeiou".includes(last)) return token === `${lemma}s`;
  return token === `${lemma}es`;
}

function isLemmaForm(
  token: Readonly<{ surface: string; folded: string }>,
  lemma: string,
  reflexiveBase: string | null,
  previousFolded: string | null,
): boolean {
  if (token.folded === lemma) return true;
  if (isPluralOf(token.folded, lemma)) return true;
  if (reflexiveBase) {
    if (isVerbForm(token.surface, reflexiveBase, true)) return true;
    // Proclitic pronoun: `me quedé`, `se queda`. The pronoun has to be the token right
    // before the verb, which is what "reflexive use" looks like without a parse.
    return previousFolded !== null
      && ["me", "te", "se", "nos", "os"].includes(previousFolded)
      && isVerbForm(token.surface, reflexiveBase, false);
  }
  return isVerbForm(token.surface, lemma, false);
}

/* -------------------------------------------------------------------------- */
/* Fetching                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Characters that appear in Traditional Chinese but not in Simplified. Used only to
 * decide whether an *unmarked* translation is safe to show; a `Hans`-marked one is
 * trusted as-is. Not a converter — the point is to keep Traditional text out rather
 * than to translate it, because the rest of this product is Simplified.
 */
const traditionalOnly = /[個們來這裡對開關無為與為實現時間東車馬電話學國語話說聽讀寫價錢銀髮門問題點電腦視覺]/u;

function simplified(text: string, script: string | null | undefined): boolean {
  if (script === "Hans") return true;
  if (script === "Hant") return false;
  return !traditionalOnly.test(text);
}

type ApiSentence = Readonly<{
  audios?: readonly { id: number; author: string; license: string; attribution_url: string }[];
  id: number;
  text: string;
  license: string | null;
  owner: string | null;
  is_unapproved?: boolean;
  translations?: readonly {
    id: number;
    text: string;
    lang: string;
    script?: string | null;
    license: string | null;
    owner: string | null;
    is_direct?: boolean;
    is_unapproved?: boolean;
  }[];
}>;

/**
 * How long to wait after a `429`.
 *
 * Measured, not guessed: at concurrency 8 the API answered `429 Too Many Requests`
 * (as HTML, which is why the request path checks the body before parsing) within
 * thirty words, and the whole shelf would have been ~2.2 hours of sustained pressure
 * on a volunteer-run service. So the run is paced deliberately: four workers, a pause
 * between requests, and a growing wait whenever the API pushes back. Slower is the
 * correct trade here — the asset is resumable and an incomplete one is a valid state
 * the UI already handles.
 */
const concurrency = Number(process.env.TATOEBA_CONCURRENCY ?? "4");
const baseDelayMs = Number(process.env.TATOEBA_DELAY_MS ?? "350");
const maxBackoffMs = 60_000;

let throttleUntil = 0;

async function politePause(): Promise<void> {
  const wait = Math.max(0, throttleUntil - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  await new Promise((resolve) => setTimeout(resolve, baseDelayMs));
}

/**
 * One word's examples, with retries.
 *
 * A `429` is not a failure to record, it is an instruction to slow down: the run backs
 * off globally (every worker waits), because the limit is per client, not per request.
 */
async function fetchExamples(word: string): Promise<readonly Example[]> {
  const url = `https://api.tatoeba.org/v1/sentences?lang=spa&q=${encodeURIComponent(word)}`
    + `&trans:lang=cmn&sort=relevance&limit=20&include=audios`;
  let backoff = 2_000;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await politePause();
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      if (attempt === 4) throw error;
      throttleUntil = Date.now() + backoff;
      backoff = Math.min(maxBackoffMs, backoff * 2);
      continue;
    }
    // The body is read as text first: Tatoeba answers a throttled request with an HTML
    // error page, and `response.json()` on it throws a parse error that hides the 429.
    const body = await response.text();
    if (response.status === 429 || !body.startsWith("{")) {
      throttleUntil = Date.now() + backoff;
      console.log(`  throttled (${response.status}); pausing ${Math.round(backoff / 1000)}s`);
      backoff = Math.min(maxBackoffMs, backoff * 2);
      continue;
    }
    if (!response.ok) throw new Error(`tatoeba ${response.status}`);
    return pickExamples((JSON.parse(body) as { data?: readonly ApiSentence[] }).data ?? [], word);
  }
  throw new Error("gave up after repeated throttling");
}

function pickExamples(sentences: readonly ApiSentence[], word: string): readonly Example[] {
  const kept: Example[] = [];
  for (const sentence of sentences) {
    if (sentence.is_unapproved) continue;
    const matchedForm = matchedLemmaForm(sentence.text, word);
    if (!matchedForm) continue;
    const translation = (sentence.translations ?? []).find(
      (candidate) => !candidate.is_unapproved && simplified(candidate.text, candidate.script),
    );
    if (!translation) continue;
    const tags = [
      "lemma-match",
      ...(foldLemmaForm(matchedForm) === foldLemmaForm(word) ? ["exact-form"] : []),
      translation.script === "Hans" ? "script-hans" : "script-unmarked",
      ...(translation.is_direct ? ["direct-translation"] : []),
    ];
    kept.push({
      text: sentence.text,
      translation: translation.text,
      sentenceId: sentence.id,
      sentenceLicense: sentence.license,
      sentenceOwner: sentence.owner,
      translationId: translation.id,
      translationLicense: translation.license,
      translationOwner: translation.owner,
      isDirect: Boolean(translation.is_direct),
      matchedForm,
      tags,
      audio: (sentence.audios ?? []).map((audio) => parseTatoebaAudio({
        id: audio.id, author: audio.author, license: audio.license, attributionUrl: audio.attribution_url,
      })).find((audio) => audio !== null) ?? null,
    });
    if (kept.length >= examplesPerWord) break;
  }
  return kept;
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

function loadExisting(): Readonly<Record<string, WordEntry>> {
  if (!resume) return {};
  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf8")) as Asset;
    return parsed.examples ?? {};
  } catch {
    return {};
  }
}

/**
 * Which shelf words this run still has to ask Tatoeba about.
 *
 * Three cases, and the third is the one that is easy to get wrong:
 * 1. never asked — fetch;
 * 2. asked, `examples: []` — only fetch when `RETRY_EMPTY=1`, because a normal resume
 *    must not re-ask a word Tatoeba already answered for (the recorded empty list is
 *    what keeps a resume from looping on the same 229 words forever); when the *rule*
 *    changes, "empty" may be the old rule's answer and `RETRY_EMPTY=1` says so;
 * 3. asked and answered, but by a build that did not write `matchedForm` — those
 *    records are kept only as a cache of an earlier rule, so they are re-asked once,
 *    automatically. Without this, every example fetched before this change would keep
 *    an empty `matchedForm` and the verifier could not require the field at all.
 */
function needsFetch(examples: Readonly<Record<string, WordEntry>>, word: string, retry: boolean): boolean {
  const entry = examples[normalizeSpanishSurface(word)];
  if (!entry) return true;
  if (entry.examples.length === 0) return retry;
  return entry.examples.some((example) => typeof (example as { matchedForm?: unknown }).matchedForm !== "string"
    || !(example as { matchedForm?: string }).matchedForm);
}

function buildAsset(examples: Readonly<Record<string, WordEntry>>): Asset {
  let exampleCount = 0;
  for (const entry of Object.values(examples)) exampleCount += entry.examples.length;
  return {
    source: "tatoeba",
    sourceUrl: "https://tatoeba.org",
    license: "CC BY 2.0 FR",
    attributionRequired: true,
    generatedAt: new Date().toISOString(),
    wordCount: Object.keys(examples).length,
    exampleCount,
    examples,
  };
}

/**
 * Write what has been fetched so far.
 *
 * Called periodically as well as at the end, because the run takes hours against a
 * volunteer service and is meant to be interruptible: with an end-only write, killing
 * the process (or a crash, or a laptop sleeping) threw away every word fetched since
 * the last completed run — the one failure mode a resumable script must not have. A
 * partially written asset is a valid state: the runtime treats a word with no entry as
 * "no Tatoeba example", which is exactly what the panel already says.
 *
 * The counts are derived here rather than kept in a variable: this is called from inside
 * the fetch loop, so anything computed after the loop would not exist yet — which is
 * exactly the `Cannot access 'withExamples' before initialization` this started as.
 */
function writeAsset(examples: Readonly<Record<string, WordEntry>>): void {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(buildAsset(examples))}\n`, "utf8");
}

async function main(): Promise<void> {
  const words = contentFrequencyWords().map((entry) => entry.word);
  const wanted = limit > 0 ? words.slice(0, limit) : words;
  const examples: Record<string, WordEntry> = { ...loadExisting() };
  const queue = wanted.filter((word) => needsFetch(examples, word, retryEmpty));
  const stale = wanted.filter((word) => {
    const entry = examples[normalizeSpanishSurface(word)];
    return Boolean(entry && entry.examples.length > 0 && needsFetch(examples, word, false));
  });
  const retried = retryEmpty
    ? wanted.filter((word) => (examples[normalizeSpanishSurface(word)]?.examples.length ?? -1) === 0)
    : [];

  const total = queue.length;

  console.log(`shelf words: ${words.length}; this run: ${wanted.length}; to fetch: ${total}`);
  console.log(`  breakdown: ${stale.length} recorded without \`matchedForm\`, ${retried.length} recorded empty`
    + `${retryEmpty ? " (retried by RETRY_EMPTY=1)" : " (skipped; set RETRY_EMPTY=1 to retry)"}, `
    + `${total - stale.length - retried.length} never asked`);

  let done = 0;
  let failed = 0;
  const started = Date.now();
  /** How often to bank progress, so an interrupted run keeps what it already paid for. */
  const writeEvery = Number(process.env.TATOEBA_WRITE_EVERY ?? "250");
  let sinceWrite = 0;

  async function worker(work: string[]): Promise<void> {
    for (;;) {
      const word = work.shift();
      if (word === undefined) return;
      const key = normalizeSpanishSurface(word);
      try {
        const found = await fetchExamples(word);
        examples[key] = { word, examples: found };
      } catch {
        failed += 1;
        // Left absent so a later run retries it; an existing empty record stays as it
        // was, which is the honest answer the UI shows ("Tatoeba 没有这个词的例句").
      }
      done += 1;
      sinceWrite += 1;
      if (sinceWrite >= writeEvery) {
        sinceWrite = 0;
        writeAsset(examples);
      }
      if (done % 100 === 0 || done === total) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(`  ${done}/${total} (${rate.toFixed(1)}/s, ${failed} failed, ${Math.round((total - done) / Math.max(rate, 0.01))}s left)`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker(queue)));

  writeAsset(examples);
  console.log(`wrote ${outputPath}`);
  const entries = Object.values(examples);
  const allExamples = entries.flatMap((entry) => entry.examples);
  const inflected = allExamples.filter((example) => !example.tags.includes("exact-form")).length;
  console.log(`words with an example: ${entries.filter((entry) => entry.examples.length > 0).length}/${entries.length}`
    + `; examples: ${allExamples.length} (${allExamples.length - inflected} exact-form, ${inflected} inflected/clitic)`
    + `; recorded with no example: ${entries.filter((entry) => entry.examples.length === 0).length}`
    + `; failed this run: ${failed}`);
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
