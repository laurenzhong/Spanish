/**
 * Real-database verification of the read-aloud data path.
 *
 * The dev server currently cannot compile the lexicon module (another session's
 * uncommitted deletion of `ui/corpus-search.tsx` leaves `index.ts` re-exporting a
 * missing file), so this exercises the parts that need the real corpus directly:
 * the address lookup, and the resolver's decision for each kind of word.
 *
 * Read-only: it never writes, and it does not call the media repository (that
 * needs a user session), so the clip branch is verified only as far as the
 * address it would hand over.
 */
import { config } from "dotenv";
config({ quiet: true });

import { createDatabaseConnection } from "../src/shared/db/client";
import { resolveWordAudioFrom } from "../src/modules/lexicon-corpus/application/resolve-word-audio";
import { wantedFormList } from "../src/modules/lexicon-corpus/repositories/corpus-form-frequency";
import { findWordAddress, resetWordAddressCache } from "../src/modules/lexicon-corpus/repositories/word-address-reader";

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) throw new Error("no database connection");
const { client, db } = createDatabaseConnection(connection);
/** The shelf's own forms: the only words a reader can click. */
const shelfForms = wantedFormList().split(" ");

const failures: string[] = [];
const check = (label: string, passed: boolean, detail = ""): void => {
  if (!passed) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

try {
  resetWordAddressCache();

  // Find a *shelf* word the materialised table picked from published media,
  // rather than assuming one: the pick is `min(text, title)`, so a word that
  // occurs in both an article and a media segment can legitimately be article
  // backed (`casa` is, which is how this check learned not to hard-code a word),
  // and the shelf only shows the reference list's own forms.
  const formsParameter = shelfForms.join(" ");
  const mediaBacked = await client.unsafe(`
    select f.word from lexicon_form_frequencies f
    where f.example_document_kind = 'media'
      and f.word = any(string_to_array($1, ' '))
    order by f.word
    limit 1
  `, [formsParameter]) as { word: string }[];
  const mediaWord = mediaBacked[0]?.word ?? "";
  check("the materialised table has at least one media-backed word", mediaWord.length > 0, `word=${mediaWord}`);

  const mediaAddress = mediaWord ? await findWordAddress(db, mediaWord) : null;
  check(
    "a media-backed word has a complete address",
    mediaAddress?.documentKind === "media"
      && typeof mediaAddress.documentStableKey === "string"
      && typeof mediaAddress.documentVersion === "number"
      && typeof mediaAddress.segmentIndex === "number",
    JSON.stringify(mediaAddress),
  );

  if (mediaAddress) {
    const resolution = await resolveWordAudioFrom({
      address: mediaAddress,
      word: mediaWord,
      // Stand in for the media read so the check is about the resolver's routing.
      loadPlayback: async () => null,
    });
    check(
      "with no playback available the resolver asks for synthesis rather than failing",
      resolution.outcome === "synthetic" && resolution.reason === "media_unavailable",
      JSON.stringify(resolution),
    );
  }

  // A word whose picked example is an article: no audio path exists at all.
  const articleBacked = await client.unsafe(`
    select f.word from lexicon_form_frequencies f
    where f.example_document_kind = 'article'
      and f.word = any(string_to_array($1, ' '))
    order by f.word
    limit 1
  `, [formsParameter]) as { word: string }[];
  const articleWord = articleBacked[0]?.word ?? "";
  const articleAddress = articleWord ? await findWordAddress(db, articleWord) : null;
  check(
    "an article example is recognised as having no audio",
    articleAddress?.documentKind === "article",
    JSON.stringify(articleAddress),
  );
  if (articleAddress && articleWord) {
    const resolution = await resolveWordAudioFrom({ address: articleAddress, word: articleWord, loadPlayback: async () => null });
    check(
      "an article example resolves to synthesis with the article reason",
      resolution.outcome === "synthetic" && resolution.reason === "article_example",
      JSON.stringify(resolution),
    );
  }

  // A word the corpus never shows: no address, so no media read is attempted.
  const missing = await findWordAddress(db, "zzzznoexiste");
  check("a word the corpus does not contain has no address", missing === null, JSON.stringify(missing));

  // The fold must be the shelf's own: an accented surface resolves to the same row.
  const accented = await findWordAddress(db, "mediodía");
  const folded = await findWordAddress(db, "mediodia");
  check(
    "an accented word resolves through the same fold the shelf uses",
    accented !== null && folded !== null && accented.word === folded.word,
    `${JSON.stringify(accented?.word)} vs ${JSON.stringify(folded?.word)}`,
  );

  // Address completeness across the whole table: a media row without a usable
  // address would be a row the resolver can never turn into audio.
  const incomplete = await client.unsafe(`
    select count(*)::text as n from lexicon_form_frequencies
    where example_document_kind = 'media'
      and (example_document_stable_key is null or example_document_version is null or example_segment_index is null)
  `) as { n: string }[];
  check("no media row is missing part of its address", incomplete[0]?.n === "0", `count=${incomplete[0]?.n}`);

  const totals = await client.unsafe(`
    select count(*)::text as total,
           count(*) filter (where example_document_kind = 'media')::text as media,
           count(*) filter (where example_document_kind = 'article')::text as article
    from lexicon_form_frequencies
  `) as { total: string; media: string; article: string }[];
  console.log(`\ncoverage: ${JSON.stringify(totals[0])}`);
} catch (error) {
  failures.push(`threw: ${String((error as Error).message).slice(0, 200)}`);
  console.log("FAIL  threw:", String((error as Error).message).slice(0, 300));
} finally {
  await client.end({ timeout: 5 });
}

console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} check(s) failed`);
process.exitCode = failures.length === 0 ? 0 : 1;
