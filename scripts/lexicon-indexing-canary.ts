/**
 * Lexicon indexing canary (LEX-INDEX-001 slice 7).
 *
 * Runs the whole chain — extraction, dual-dimension review, approval gate,
 * persistence — against ONE real published article, so the pipeline can be seen
 * working end to end instead of only in tests.
 *
 * Defaults to `review-only`: candidates are persisted for review and **nothing
 * reaches the corpus**. That is the safe way to observe the chain, and it is the
 * mode ADR-0011 expects to be used before indexing is switched on.
 *
 * Ordering of guarantees, because they are the point of the slice:
 *   - `disabled` is a pure no-op: providers are never constructed, so zero paid
 *     calls can happen.
 *   - `--dry-run` reads the article and its segments, then stops: no provider,
 *     no writes.
 *   - `review-only` pays once. A second run over the same article re-reads the
 *     verdicts already on record rather than buying them again, which is what
 *     the run counter below is there to prove.
 *
 * Run it like the other provider scripts, since api.minimaxi.com is not
 * reachable directly from this machine:
 *
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"
 *   node --use-env-proxy --conditions=react-server --import tsx/esm \
 *     scripts/lexicon-indexing-canary.ts [--dry-run] [--max=15]
 *
 * Env: LEXICON_INDEXING_MODE=disabled|review-only|index (default `review-only`).
 */
import { config as loadDotEnv } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";

import { createDatabaseConnection } from "../src/shared/db/client";
import * as schema from "../src/shared/db/schema";
import { resolveLexiconIndexingMode, type LexiconIndexingMode } from "../src/modules/lexicon-corpus/application/lexicon-indexing-mode";
import {
  runLexiconIndexingPipeline,
  type LexiconIndexingSegment,
} from "../src/modules/lexicon-corpus/application/lexicon-indexing-pipeline";
import { createDrizzleLexiconCandidateRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import { createDrizzleLexiconCorpusRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";

loadDotEnv({ quiet: true });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const maxSegments = Number(args.find((arg) => arg.startsWith("--max="))?.slice("--max=".length) ?? 8);

/**
 * The canary's own default. `resolveLexiconIndexingMode()` returns `disabled`
 * when nothing is configured, which is right for production but would make the
 * canary a no-op by accident, so the canary opts itself into observation mode
 * explicitly and says so in the output.
 */
const configuredMode = process.env.LEXICON_INDEXING_MODE;
const mode: LexiconIndexingMode = configuredMode
  ? resolveLexiconIndexingMode(process.env)
  : "review-only";

const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connection) {
  console.log("no database connection string configured");
  process.exit(1);
}

const { client, db } = createDatabaseConnection(connection);
const line = (label: string, value: unknown): void => console.log(`  ${label.padEnd(26)} ${String(value)}`);

console.log("=== lexicon indexing canary ===");
line("mode", mode);
line("mode source", configuredMode ? `LEXICON_INDEXING_MODE=${configuredMode}` : "canary default (env unset)");
line("dry run", dryRun);
line("max segments", maxSegments);

let exitCode = 0;

try {
  // ---------------------------------------------------------------- the article
  const article = (
    await db
      .select({
        stableKey: schema.articles.stableKey,
        versionId: schema.articleVersions.id,
        version: schema.articleVersions.version,
        title: schema.articleVersions.title,
        locale: schema.articleVersions.locale,
      })
      .from(schema.articles)
      .innerJoin(schema.articleVersions, eq(schema.articleVersions.articleId, schema.articles.id))
      .where(eq(schema.articleVersions.status, "published"))
      .orderBy(asc(schema.articles.stableKey))
      .limit(1)
  )[0];

  if (!article) {
    console.log("\nno published article with a version found; nothing to canary");
    process.exit(2);
  }

  console.log("\n--- article ---");
  line("stable key", article.stableKey);
  line("title", article.title);
  line("version", `${article.version} (${article.locale})`);

  const paragraphRows = await db
    .select({ position: schema.articleSegments.position, sourceText: schema.articleSegments.sourceText })
    .from(schema.articleSegments)
    .where(eq(schema.articleSegments.articleVersionId, article.versionId))
    .orderBy(asc(schema.articleSegments.position))
    .limit(maxSegments);

  console.log("\n--- segments ---");
  line("paragraphs available", paragraphRows.length);
  for (const row of paragraphRows.slice(0, 3)) {
    console.log(`    [${row.position}] ${row.sourceText.slice(0, 90)}${row.sourceText.length > 90 ? "…" : ""}`);
  }
  if (paragraphRows.length > 3) console.log(`    … and ${paragraphRows.length - 3} more`);

  const segments: LexiconIndexingSegment[] = paragraphRows.map((row) => ({
    documentKind: "article" as const,
    documentStableKey: article.stableKey,
    documentVersion: article.version,
    segmentIndex: row.position,
    sourceText: row.sourceText,
    // The Chinese gloss is produced by the review step, not by extraction.
    translation: null,
    sourceTitle: article.title,
    sourceKind: "article-rss",
    paragraphId: `${article.stableKey}#${row.position}`,
  }));

  if (segments.length === 0) {
    console.log("\nno article segments found for the chosen version; nothing to canary");
    process.exit(2);
  }

  // ------------------------------------------------------------------ dry run
  if (dryRun) {
    console.log("\n--- dry run ---");
    line("providers constructed", "none");
    line("database writes", "none");
    line("paid calls", 0);
    console.log("\ndry run complete: the article and its segments are readable and usable.");
    process.exit(0);
  }

  // ------------------------------------------------------- disabled is a no-op
  const candidatesBefore = (
    await db.execute<{ n: number }>(
      sql`select count(*)::int as n from lexicon_candidates where document_stable_key = ${article.stableKey}`,
    )
  )[0]?.n;

  if (mode === "disabled") {
    console.log("\n--- disabled ---");
    line("providers constructed", "none");
    line("pipeline invoked", false);
    line("paid calls", 0);
    line("stored candidates", candidatesBefore ?? 0);
    console.log("\nmode is disabled: nothing was extracted, reviewed, written or paid for.");
    process.exit(0);
  }

  // ----------------------------------------------------------- the real chain
  // Imported lazily so that `--dry-run` and `disabled` never load a module that
  // reads an API key or reaches the network.
  const { createMiniMaxLexiconExtractionProvider } = await import(
    "../src/modules/providers/lexicon-extraction/server"
  );
  const { createMiniMaxCandidateReviewer } = await import("../src/modules/providers/lexicon-review/server");

  const provider = createMiniMaxLexiconExtractionProvider();
  const reviewer = createMiniMaxCandidateReviewer();
  const candidates = createDrizzleLexiconCandidateRepository(db);
  const corpus = createDrizzleLexiconCorpusRepository(db);

  const started = Date.now();
  const result = await runLexiconIndexingPipeline(
    { provider, reviewer, candidates, corpus },
    {
      mode,
      segments,
      // `index` mode additionally requires an owner-authorized approver and an
      // audit store; the canary refuses that combination rather than inventing
      // either. See the note printed below.
      approvedBy: null,
      now: new Date(),
      maxCandidatesPerSegment: 12,
    },
  );
  const elapsed = Date.now() - started;

  console.log("\n--- run ---");
  line("elapsed ms", elapsed);

  if (!result.ok) {
    line("ok", false);
    line("failure code", result.code);
    line("candidate", result.candidateId ?? "(run-level)");
    line("detail", result.detail);
    if (result.code === "INDEXING_APPROVER_NOT_AUTHORIZED" || result.code === "INDEXING_AUDIT_STORE_MISSING") {
      console.log(
        "\nnote: `index` mode needs an owner-authorized approver and a Drizzle-backed\n" +
          "approval-audit store. The audit table exists (migration 0042) but no Drizzle\n" +
          "implementation of `LexiconCandidateApprovalAuditStore` has been written yet, so\n" +
          "indexing cannot be exercised end to end. That is a reported gap, not a silent one.",
      );
    }
    exitCode = 1;
  } else {
    line("ok", true);
    line("skipped", result.skipped ?? "(did work)");
    console.log("\n--- counts ---");
    for (const [key, value] of Object.entries(result.counts)) line(key, value);
    console.log("\n--- provider usage ---");
    line("called", result.providerUsage.called);
    line("provider", result.providerUsage.provider ?? "(none)");
    line("model", result.providerUsage.modelVersion ?? "(none)");
    line("estimated cost micros", result.providerUsage.estimatedCostMicros ?? "(not supplied)");

    console.log("\n--- candidates ---");
    for (const outcome of result.candidates.slice(0, 20)) {
      line(
        outcome.candidateId.slice(0, 46),
        `${outcome.status} rev=${outcome.revision} ${outcome.persistence} indexed=${outcome.indexed}`,
      );
    }
    if (result.candidates.length > 20) console.log(`    … and ${result.candidates.length - 20} more`);

    const candidatesAfter = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from lexicon_candidates where document_stable_key = ${article.stableKey}`,
      )
    )[0]?.n;
    console.log("\n--- stored rows for this article ---");
    line("before", candidatesBefore ?? 0);
    line("after", candidatesAfter ?? 0);
    line("paid calls this run", 1 + result.counts.reviewCalls);

    console.log(
      "\nread this as: `paid calls this run` is the whole cost of the run — one extraction\n" +
        "plus one call per review verdict. Running it again should show a smaller number\n" +
        "for the same article, because verdicts already on record are re-read, not re-bought.",
    );
  }
} catch (error) {
  console.log("\ncanary failed:");
  console.log(String(error).slice(0, 1_200));
  exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
  process.exitCode = exitCode;
}
