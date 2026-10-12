/**
 * Lexicon indexing batch (LEX-INDEX-001): the same chain the canary runs, over a
 * bounded set of real published documents instead of one.
 *
 * Always `review-only`. That is not a flag here on purpose: this script's job is
 * to measure what extraction and review produce, and `review-only` is the mode in
 * which the pipeline can persist candidates for review but is *incapable* of
 * writing the corpus — `approvedBy` is null, so nothing can reach `approved` and
 * no `lexemes`, `phrase_entries` or `corpus_occurrences` row can appear. Anything
 * that writes the corpus stays in the canary, behind its confirmation flag.
 *
 * The call counts are measured rather than inferred: the provider and reviewer
 * are wrapped, so "extraction calls" is how many times the extraction provider
 * was really invoked and "review calls" is how many review requests were really
 * sent — not what the pipeline believes it did.
 *
 * Call model, for the projection: **one extraction call per document** (all its
 * segments in one request) and **two review calls per candidate**, one per
 * dimension.
 *
 * Run like the other provider scripts (api.minimaxi.com needs the local proxy):
 *
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"
 *   node --use-env-proxy --conditions=react-server --import tsx/esm \
 *     scripts/lexicon-indexing-batch.ts --documents=3 --segments=6
 *
 * Documents that already have stored candidates are skipped, so re-running the
 * same command explores new material rather than re-reading — and re-paying for —
 * verdicts already on record.
 */
import { and, asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { config as loadDotEnv } from "dotenv";

import { createDatabaseConnection } from "../src/shared/db/client";
import * as schema from "../src/shared/db/schema";
import { runLexiconIndexingPipeline, type LexiconIndexingSegment } from "../src/modules/lexicon-corpus/application/lexicon-indexing-pipeline";
import { createDrizzleLexiconCandidateRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import { createDrizzleLexiconCorpusRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";

loadDotEnv({ quiet: true });

const args = process.argv.slice(2);
const readNumber = (name: string, fallback: number): number => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const documentCount = readNumber("documents", 3);
const segmentsPerDocument = readNumber("segments", 6);
const maxCandidatesPerSegment = readNumber("max-candidates", 12);
/**
 * Where proposals come from.
 *
 * `extraction` is the language-model extractor, which costs one paid call per
 * document. `reference` proposes only the 7,922 forms of the committed reference
 * list and makes no extraction call at all — the route the measured 147-day
 * corpus sweep ruled out (see `application/reference-list-candidate-provider.ts`).
 */
const source = args.find((arg) => arg.startsWith("--source="))?.slice("--source=".length) ?? "extraction";

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection configured");
  process.exit(1);
}
const { client, db } = createDatabaseConnection(connection);

type CallLog = { calls: number; failures: number; totalMs: number; latencies: number[] };
const extractionLog: CallLog = { calls: 0, failures: 0, totalMs: 0, latencies: [] };
const reviewLog: CallLog = { calls: 0, failures: 0, totalMs: 0, latencies: [] };

async function counted<T>(log: CallLog, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  log.calls += 1;
  try {
    return await run();
  } catch (error) {
    log.failures += 1;
    throw error;
  } finally {
    const elapsed = Date.now() - started;
    log.totalMs += elapsed;
    log.latencies.push(elapsed);
  }
}

function summarise(log: CallLog): string {
  if (log.calls === 0) return "0 calls";
  const sorted = [...log.latencies].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return `${log.calls} calls (${log.failures} failed), median ${median} ms, total ${(log.totalMs / 1000).toFixed(1)} s`;
}

async function chooseArticles(limit: number): Promise<readonly { stableKey: string; versionId: string; version: number; title: string }[]> {
  const rows = await db
    .select({
      stableKey: schema.articles.stableKey,
      versionId: schema.articleVersions.id,
      version: schema.articleVersions.version,
      title: schema.articleVersions.title,
    })
    .from(schema.articles)
    .innerJoin(schema.articleVersions, eq(schema.articleVersions.articleId, schema.articles.id))
    .innerJoin(schema.articleSources, eq(schema.articleVersions.sourceId, schema.articleSources.id))
    .where(and(
      eq(schema.articleVersions.status, "published"),
      eq(schema.articleSources.copyrightStatus, "cleared"),
      notExists(
        db.select({ one: sql`1` })
          .from(schema.userGeneratedArticles)
          .where(eq(schema.userGeneratedArticles.articleVersionId, schema.articleVersions.id)),
      ),
    ))
    .orderBy(asc(schema.articles.stableKey))
    .limit(limit * 5);

  const chosen: { stableKey: string; versionId: string; version: number; title: string }[] = [];
  for (const row of rows) {
    if (chosen.length >= limit) break;
    const stored = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from lexicon_candidates where document_stable_key = ${row.stableKey}`,
      )
    )[0]?.n ?? 0;
    if (stored > 0) continue;
    chosen.push(row);
  }
  return chosen;
}

type DocumentRun = Readonly<{
  stableKey: string;
  segments: number;
  extracted: number;
  created: number;
  existing: number;
  rejected: number;
  ready: number;
  /** Member proposals the fixed-expression rule dropped before any paid call. */
  membersDropped: number;
  /** Phrase proposals the rule added for expressions found in the segments. */
  phrasesAdded: number;
  failed: string | null;
  elapsedMs: number;
}>;

async function runDocument(article: { stableKey: string; versionId: string; version: number; title: string }): Promise<DocumentRun> {
  const started = Date.now();
  const rows = await db
    .select({ position: schema.articleSegments.position, sourceText: schema.articleSegments.sourceText })
    .from(schema.articleSegments)
    .where(eq(schema.articleSegments.articleVersionId, article.versionId))
    .orderBy(asc(schema.articleSegments.position))
    .limit(segmentsPerDocument);

  const segments: LexiconIndexingSegment[] = rows.map((row) => ({
    documentKind: "article" as const,
    documentStableKey: article.stableKey,
    documentVersion: article.version,
    segmentIndex: row.position,
    sourceText: row.sourceText,
    translation: null,
    sourceTitle: article.title,
    sourceKind: "article-rss",
    paragraphId: `${article.stableKey}#${row.position}`,
  }));

  const { createMiniMaxLexiconExtractionProvider } = await import("../src/modules/providers/lexicon-extraction/server");
  const { createMiniMaxCandidateReviewer } = await import("../src/modules/providers/lexicon-review/server");
  const { createReferenceListCandidateProvider } = await import(
    "../src/modules/lexicon-corpus/application/reference-list-candidate-provider"
  );
  const provider = source === "reference"
    ? createReferenceListCandidateProvider()
    : createMiniMaxLexiconExtractionProvider();
  const reviewer = createMiniMaxCandidateReviewer();

  const result = await runLexiconIndexingPipeline(
    {
      provider: {
        extractCandidates: (input, options) => counted(extractionLog, () => provider.extractCandidates(input, options)),
      },
      reviewer: {
        review: (input, options) => counted(reviewLog, () => reviewer.review(input, options)),
      },
      candidates: createDrizzleLexiconCandidateRepository(db),
      corpus: createDrizzleLexiconCorpusRepository(db),
    },
    {
      mode: "review-only",
      segments,
      approvedBy: null,
      now: new Date(),
      maxCandidatesPerSegment,
    },
  );

  const base = {
    stableKey: article.stableKey,
    segments: segments.length,
    elapsedMs: Date.now() - started,
  };
  if (!result.ok) {
    return {
      ...base,
      extracted: 0,
      created: 0,
      existing: 0,
      rejected: 0,
      ready: 0,
      membersDropped: 0,
      phrasesAdded: 0,
      failed: `${result.code}: ${result.detail}`.slice(0, 150),
    };
  }
  return {
    ...base,
    extracted: result.counts.extracted,
    created: result.counts.created,
    existing: result.counts.existing,
    rejected: result.counts.rejected,
    ready: result.candidates.filter((candidate) => candidate.status === "review_ready").length,
    membersDropped: result.counts.fixedExpressionMembersDropped,
    phrasesAdded: result.counts.fixedExpressionPhrasesAdded,
    failed: null,
  };
}

console.log("=== lexicon indexing batch (review-only) ===");
console.log(`  source              ${source}`);
console.log(`  documents           ${documentCount}`);
console.log(`  segments/document   ${segmentsPerDocument}`);
console.log(`  max candidates/seg  ${maxCandidatesPerSegment}\n`);

const articles = await chooseArticles(documentCount);
if (articles.length === 0) {
  console.log("no un-indexed published article found");
  await client.end({ timeout: 5 });
  process.exit(2);
}

const startedAll = Date.now();
const runs: DocumentRun[] = [];
for (const article of articles) {
  const run = await runDocument(article);
  runs.push(run);
  console.log(
    `  ${run.stableKey.slice(0, 44).padEnd(46)} seg=${String(run.segments).padStart(2)} `
      + `extracted=${String(run.extracted).padStart(3)} new=${String(run.created).padStart(3)} `
      + `existing=${String(run.existing).padStart(3)} rejected=${String(run.rejected).padStart(3)} `
      + `ready=${String(run.ready).padStart(3)} ${run.failed ? `FAILED ${run.failed}` : `${run.elapsedMs} ms`}`,
  );
}
const elapsedAll = Date.now() - startedAll;

const sum = (pick: (run: DocumentRun) => number): number => runs.reduce((total, run) => total + pick(run), 0);
const allCalls = extractionLog.calls + reviewLog.calls;
const extracted = sum((run) => run.extracted);
const ready = sum((run) => run.ready);

console.log("\n--- totals ---");
console.log(`  documents            ${runs.length}`);
console.log(`  segments             ${sum((run) => run.segments)}`);
console.log(`  candidates extracted ${extracted}`);
console.log(`  candidates created   ${sum((run) => run.created)}`);
console.log(`  candidates existing  ${sum((run) => run.existing)}`);
console.log(`  rejected             ${sum((run) => run.rejected)}`);
console.log(`  reached review_ready ${ready}`);
console.log(`  fixed-expr members dropped  ${sum((run) => run.membersDropped)}`);
console.log(`  fixed-expr phrases added    ${sum((run) => run.phrasesAdded)}`);
console.log(`  extraction provider  ${summarise(extractionLog)}`);
console.log(`  reviewer             ${summarise(reviewLog)}`);
console.log(`  wall clock           ${(elapsedAll / 1000).toFixed(1)} s`);
console.log(`  measured rate        ${(allCalls / (elapsedAll / 60_000)).toFixed(1)} calls/min`);
if (extracted > 0) {
  console.log(`  calls per candidate  ${(allCalls / extracted).toFixed(2)} including extraction`);
  console.log(`  calls per candidate  ${(reviewLog.calls / extracted).toFixed(2)} review only`);
}

const keys = articles.map((article) => article.stableKey);
const batchCandidates = await db
  .select({
    id: schema.lexiconCandidates.id,
    word: schema.lexiconCandidates.sourceText,
    kind: schema.lexiconCandidates.candidateKind,
    partOfSpeech: schema.lexiconCandidates.partOfSpeech,
    meaningZh: schema.lexiconCandidates.meaningZh,
    status: schema.lexiconCandidates.status,
    reviews: schema.lexiconCandidates.reviews,
  })
  .from(schema.lexiconCandidates)
  .where(inArray(schema.lexiconCandidates.documentStableKey, keys));

const outcomeOf = (review: unknown): string =>
  review && typeof review === "object" && "outcome" in review ? String((review as { outcome: unknown }).outcome) : "?";
const dimensionOf = (review: unknown): string =>
  review && typeof review === "object" && "dimension" in review ? String((review as { dimension: unknown }).dimension) : "?";

const readyRows = batchCandidates
  .map((candidate) => {
    const reviews = (candidate.reviews ?? []) as unknown[];
    return {
      ...candidate,
      pass: reviews.filter((review) => outcomeOf(review) === "pass").length,
      fail: reviews.filter((review) => outcomeOf(review) === "fail").length,
      dimensions: reviews.map((review) => `${dimensionOf(review)}:${outcomeOf(review)}`).join(" "),
    };
  })
  .filter((candidate) => candidate.status === "review_ready");

console.log(`\n--- what the owner would see: review_ready (${readyRows.length} of ${batchCandidates.length} stored in this batch) ---`);
for (const row of readyRows.slice(0, 30)) {
  console.log(
    `  ${row.word.padEnd(24)} ${row.kind.padEnd(7)} ${(row.partOfSpeech ?? "-").padEnd(6)} `
      + `${row.dimensions.padEnd(34)} ${(row.meaningZh ?? "").slice(0, 22)}`,
  );
}
if (readyRows.length > 30) console.log(`    … and ${readyRows.length - 30} more`);

await client.end({ timeout: 5 });
process.exit(0);
