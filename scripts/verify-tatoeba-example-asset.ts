/**
 * Verify the Tatoeba example asset against the rules it is supposed to have been built
 * with.
 *
 * The builder enforces these; this checks the *written file*, because the two can
 * disagree — a shape mismatch between builder and reader already shipped once as
 * "available but zero words", silently, and a filter that stops being applied would look
 * exactly like Tatoeba simply having no example for those words. That is precisely what
 * happened to `haber`: the first builder accepted only the bare token, so 529 real
 * sentences were thrown away and the asset recorded the word as having none. This is
 * also the check to run after the asset grows, since every word added is a fresh chance
 * for one of these rules to slip.
 *
 * The matching check is delegated to `matchedLemmaForm`, the builder's own rule, rather
 * than reimplemented: a second copy here could drift from the one that produced the file
 * and then pass data the builder would never write. What this script adds is that the
 * rule must be able to *reproduce* each record from the sentence — the asset has to be
 * reproducible, not merely self-consistent.
 *
 * `matchedForm` is checked twice on purpose. Once against the raw JSON, which is the
 * only place the field is guaranteed to be: `parseTatoebaExampleAsset` used to rebuild a
 * fixed record shape and drop it, so the raw document is what the builder is actually
 * answerable for. And once through the parser, because a field the builder writes and
 * the reader does not surface is exactly the "available but zero words" shape mismatch
 * this script exists for — and it is invisible from the file alone. Both must agree.
 *
 * Read-only.
 *
 * Usage:
 *   npx tsx scripts/verify-tatoeba-example-asset.ts
 *   TATOEBA_ASSET_PATH=... npx tsx scripts/verify-tatoeba-example-asset.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

config({ quiet: true });

import { foldLemmaForm, matchedLemmaForm } from "./build-tatoeba-example-asset";
import { parseTatoebaExampleAsset } from "@/src/modules/lexicon-corpus/application/tatoeba-examples";

const assetPath = process.env.TATOEBA_ASSET_PATH
  ?? path.join(process.cwd(), "content", "word-lists", "es-examples-tatoeba-v1.json");

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const raw = JSON.parse(readFileSync(assetPath, "utf8")) as unknown;
const asset = parseTatoebaExampleAsset(raw);

check("the asset parses", asset.available);
check("it declares its licence", asset.license === "CC BY 2.0 FR", String(asset.license));
check("it names its source", asset.sourceUrl === "https://tatoeba.org", String(asset.sourceUrl));

const entries = Object.entries(asset.examples);
const total = entries.reduce((sum, [, list]) => sum + list.length, 0);
console.log(`\nwords: ${entries.length} | examples: ${total}\n`);
check("it carries at least one word", entries.length > 0);

type RawWord = Readonly<{ word?: unknown; examples?: readonly unknown[] }>;
const rawExamples = (raw as { examples?: Record<string, RawWord> }).examples ?? {};

/** Characters that mark Traditional Chinese; the UI is Simplified-only. */
const traditionalOnly = /[個們來這裡對開關無為與為實現時間東車馬電話學國語話說聽讀寫價錢銀髮門問題點電腦視覺]/u;

const badScript: string[] = [];
const missingAttribution: string[] = [];
const emptyText: string[] = [];
const badTag: string[] = [];
const readerFormProblems: string[] = [];

for (const [word, list] of entries) {
  for (const example of list) {
    const marksHans = example.tags.includes("script-hans");
    if (!marksHans && traditionalOnly.test(example.translation)) badScript.push(`${word} -> ${example.translation}`);
    // CC BY 2.0 FR requires the author and licence for the sentence and the translation.
    if (!example.sentenceOwner || !example.sentenceLicense || !example.translationOwner || !example.translationLicense) {
      missingAttribution.push(`${word} #${example.sentenceId}`);
    }
    if (!example.text.trim() || !example.translation.trim()) emptyText.push(`${word} #${example.sentenceId}`);
    // "lemma-match" replaced the old "whole-token" tag when the rule changed; a file
    // still carrying the old tag was built by the rule that lost `había` and `haberlo`.
    if (!example.tags.includes("lemma-match")) badTag.push(`${word} -> ${JSON.stringify(example.tags)}`);
    // What the runtime actually reads. It must be there, and it must be what the file
    // says: the builder writing a field the reader drops is a silent shape mismatch.
    const fromFile = rawMatchedForm(word, example.sentenceId);
    if (!example.matchedForm) readerFormProblems.push(`${word} #${example.sentenceId}: reader sees null`);
    else if (example.matchedForm !== fromFile) {
      readerFormProblems.push(`${word} #${example.sentenceId}: reader ${example.matchedForm}, file ${fromFile}`);
    }
  }
}

check("every translation is Simplified or script-marked", badScript.length === 0, badScript.slice(0, 3).join(" | "));
check("every pair carries both authors and both licences", missingAttribution.length === 0, missingAttribution.slice(0, 3).join(" | "));
check("no pair is missing its text", emptyText.length === 0, emptyText.slice(0, 3).join(" | "));
check("every pair is tagged as a lemma match", badTag.length === 0, badTag.slice(0, 3).join(" | "));
check(
  "the runtime reader exposes the same matchedForm the file records",
  readerFormProblems.length === 0,
  readerFormProblems.slice(0, 3).join(" | "),
);

// The matching rule, checked per record: the sentence must yield exactly the form the
// file recorded, and that form must really occur in the sentence. A record whose
// `matchedForm` is missing is a record from the old bare-token build.
const notReproducible: string[] = [];
const missingMatchedForm: string[] = [];
const formNotInSentence: string[] = [];
let exactForms = 0;
let inflectedForms = 0;

for (const [key, entry] of Object.entries(rawExamples)) {
  const lemma = typeof entry.word === "string" && entry.word.trim() ? entry.word : key;
  for (const value of entry.examples ?? []) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";
    if (!text) continue; // already reported by "no pair is missing its text"
    const matchedForm = typeof record.matchedForm === "string" ? record.matchedForm : "";
    if (!matchedForm) {
      missingMatchedForm.push(`${lemma} #${record.sentenceId}`);
      continue;
    }
    // Independent of the rule: the recorded form is a whole token of the sentence it
    // claims to come from (`había` is in `No había gatos.`, `habia` would not be).
    const sentenceTokens: readonly string[] = text.match(/[\p{L}\p{M}]+/gu) ?? [];
    if (!sentenceTokens.includes(matchedForm)) {
      formNotInSentence.push(`${lemma} -> ${matchedForm} not in "${text}"`);
      continue;
    }
    const derived = matchedLemmaForm(text, lemma);
    if (derived !== matchedForm) {
      notReproducible.push(`${lemma} -> recorded ${matchedForm}, rule derives ${derived ?? "no match"} ("${text}")`);
      continue;
    }
    if (foldLemmaForm(derived) === foldLemmaForm(lemma)) exactForms += 1;
    else inflectedForms += 1;
  }
}

check("every example records the form that matched", missingMatchedForm.length === 0, missingMatchedForm.slice(0, 3).join(" | "));
check("every recorded form occurs in its sentence", formNotInSentence.length === 0, formNotInSentence.slice(0, 3).join(" | "));
check(
  "the lemma rule reproduces every recorded match (so `había`/`haberlo` live, `habas` does not)",
  notReproducible.length === 0,
  notReproducible.slice(0, 3).join(" | "),
);
const inflectedShare = total === 0 ? 0 : Math.round((inflectedForms / total) * 100);
console.log(`\n(matched forms: ${exactForms} exact, ${inflectedForms} inflected/clitic — ${inflectedShare}% of the asset is invisible to a bare-token rule)`);

// The builder stores a word it looked up but found nothing for as `examples: []`, while
// the parser drops such an entry. That difference is deliberate — the file should record
// that the word was asked about (so a later run does not re-fetch it as "missing"), and
// the reader should not see it at all. What must never differ is the *reader's* answer:
// an empty list and an absent key both have to mean "no example", because the panel asks
// only whether there is one and would otherwise show an empty section.
const emptyEntries = Object.entries(rawExamples)
  .filter(([, entry]) => Array.isArray(entry?.examples) && entry.examples.length === 0)
  .map(([word]) => word);
const leakedEmpty = emptyEntries.filter((word) => word in asset.examples);
check(
  "a looked-up-but-empty word reads as no example, not as an empty section",
  leakedEmpty.length === 0,
  leakedEmpty.slice(0, 5).join(", "),
);
console.log(`\n(words recorded with no example: ${emptyEntries.length}; the file keeps them so a later run does not re-fetch them unless RETRY_EMPTY=1)`);

const header = raw as { wordCount?: unknown; exampleCount?: unknown };
check(
  "the file's own counts match its content",
  header.wordCount === Object.keys(rawExamples).length && header.exampleCount === total,
  `header ${String(header.wordCount)}/${String(header.exampleCount)} vs content ${Object.keys(rawExamples).length}/${total}`,
);

function rawMatchedForm(key: string, sentenceId: number): string {
  for (const value of rawExamples[key]?.examples ?? []) {
    const record = value as { sentenceId?: unknown; matchedForm?: unknown };
    if (record?.sentenceId === sentenceId && typeof record.matchedForm === "string") return record.matchedForm;
  }
  return "?";
}

const sample = entries.filter(([, list]) => list.length > 0).slice(0, 5);
console.log("\nsample:");
for (const [word, list] of sample) {
  const example = list[0]!;
  console.log(`  ${word}: ${example.text} → ${example.translation}`);
  console.log(`      matched "${rawMatchedForm(word, example.sentenceId)}" | #${example.sentenceId} ${example.sentenceOwner} (${example.sentenceLicense}) | 译文 #${example.translationId} ${example.translationOwner} (${example.translationLicense})`);
}

console.log(`\n${failures === 0 ? "all asset checks passed" : `${failures} asset check(s) failed`}`);
process.exitCode = failures === 0 ? 0 : 1;
