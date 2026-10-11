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
 *   - `index` writes the corpus for real, so it needs **two** independent things:
 *     `LEXICON_INDEXING_MODE=index` *and* the explicit confirmation argument
 *     below. Neither alone is enough, and the refusal happens before the
 *     database connection is opened, so an unconfirmed run cannot write,
 *     cannot call a provider and cannot even read.
 *
 * Run it like the other provider scripts, since api.minimaxi.com is not
 * reachable directly from this machine:
 *
 *   $env:HTTPS_PROXY="http://127.0.0.1:7897"
 *   node --use-env-proxy --conditions=react-server --import tsx/esm \
 *     scripts/lexicon-indexing-canary.ts [--dry-run] [--max=15]
 *
 * Indexing one article, deliberately:
 *
 *   $env:LEXICON_INDEXING_MODE="index"
 *   node --conditions=react-server --import tsx/esm scripts/lexicon-indexing-canary.ts \
 *     --i-understand-this-writes-to-the-corpus
 *
 * Env: LEXICON_INDEXING_MODE=disabled|review-only|index (default `review-only`).
 */

import { pathToFileURL } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";

import { createDatabaseConnection } from "../src/shared/db/client";
import * as schema from "../src/shared/db/schema";
import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "../src/modules/content-acquisition/domain/review-identity";
import {
  LEXICON_INDEXING_MODE_ENV_KEY,
  resolveLexiconIndexingMode,
  type LexiconIndexingEnvironment,
  type LexiconIndexingMode,
} from "../src/modules/lexicon-corpus/application/lexicon-indexing-mode";
import {
  runLexiconIndexingPipeline,
  type LexiconIndexingSegment,
} from "../src/modules/lexicon-corpus/application/lexicon-indexing-pipeline";
import { createDrizzleLexiconCandidateApprovalAuditStore } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-approval-audit-store";
import { createDrizzleLexiconCandidateRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-candidate-repository";
import { createDrizzleLexiconCorpusRepository } from "../src/modules/lexicon-corpus/repositories/drizzle-lexicon-corpus-repository";

/**
 * The confirmation argument `index` mode requires.
 *
 * Named for what it does rather than `--yes`, because the operator is agreeing
 * to a corpus write, not to a prompt. It is checked against the argument list
 * only — never an environment variable — so enabling indexing takes a deliberate
 * edit to the command line rather than a stray variable in a shell profile.
 */
export const CANARY_INDEX_CONFIRMATION_FLAG = "--i-understand-this-writes-to-the-corpus";

/** What the canary is allowed to do, and why. Pure, so the gate is testable. */
export type CanaryModeDecision = Readonly<{
  mode: LexiconIndexingMode;
  /** Which input decided the mode. */
  source: "env" | "canary-default";
  /** The raw configured value, kept so the output can show what was ignored. */
  configuredValue: string | null;
  /** True when `index` was requested without the confirmation argument. */
  refused: boolean;
  refusal: string | null;
}>;

/**
 * Resolve the canary's mode, fail-closed.
 *
 * The `index` rung needs both the environment switch and the confirmation
 * argument. Everything else — including an unset or unrecognised value — stays
 * at `review-only` or below, and an unconfirmed `index` is refused rather than
 * downgraded: silently running a different mode than the one asked for would be
 * its own surprise.
 */
export function resolveCanaryMode(
  environment: LexiconIndexingEnvironment,
  args: readonly string[],
): CanaryModeDecision {
  const configuredValue = environment[LEXICON_INDEXING_MODE_ENV_KEY] ?? null;
  const mode: LexiconIndexingMode = configuredValue
    ? resolveLexiconIndexingMode(environment)
    : "review-only";
  const source: CanaryModeDecision["source"] = configuredValue ? "env" : "canary-default";

  if (mode === "index" && !args.includes(CANARY_INDEX_CONFIRMATION_FLAG)) {
    return {
      mode,
      source,
      configuredValue,
      refused: true,
      refusal:
        `index mode writes to the real corpus. Re-run with ${CANARY_INDEX_CONFIRMATION_FLAG} `
        + "to confirm that, or unset " + LEXICON_INDEXING_MODE_ENV_KEY + " to review only.",
    };
  }
  return { mode, source, configuredValue, refused: false, refusal: null };
}

/** Everything the pre-write summary needs. Kept plain so it can be tested. */
export type CanaryIndexWritePlan = Readonly<{
  stableKey: string;
  documentVersion: number;
  segmentIndexes: readonly number[];
  /** Candidate rows already stored for this document version. */
  storedCandidates: number;
  /** Approval audit rows already recorded for them. */
  storedApprovals: number;
  approver: string;
}>;

/**
 * The lines printed immediately before an `index` run.
 *
 * An operator about to write to a real corpus should be able to read, in the
 * output, which document is affected, who the approval is attributed to, how
 * much is already stored, and which tables will change. The approver line states
 * the AI identity outright: `AGENTS.md` §8 requires the owner-authorized review
 * to be labelled as the agent platform's own review, never as a human, a native
 * speaker or a teaching expert.
 */
export function describeIndexWritePlan(plan: CanaryIndexWritePlan): readonly string[] {
  const segments = plan.segmentIndexes.length === 0 ? "none" : plan.segmentIndexes.join(", ");
  return [
    "index mode WILL WRITE to the target database, and nothing is rolled back afterwards.",
    `  document            ${plan.stableKey} v${plan.documentVersion}`,
    `  segments            ${plan.segmentIndexes.length} (${segments})`,
    `  approver            ${plan.approver}`,
    "  approver identity   AI review by the agent platform (owner-authorized): not a human",
    "                      reviewer, not a native-speaker sign-off and not a teaching-expert",
    "                      sign-off (AGENTS.md §8).",
    `  already stored      ${plan.storedCandidates} candidate row(s), ${plan.storedApprovals} approval audit row(s)`,
    "  tables written",
    "    lexicon_candidates           one row per extracted candidate (insert, else CAS-save)",
    "    lexicon_candidate_approvals  one approval audit row per candidate this run approves",
    "    lexemes / lexeme_forms       through indexContentVersion(), deduplicated by unique key",
    "    phrase_entries               through indexContentVersion(), deduplicated by unique key",
    "    corpus_occurrences           through indexContentVersion(), deduplicated by unique key",
    "  never written       evidence_events, mastery, confidence (ADR-0011 §6)",
  ];
}

/** `true` when this module is the process entry point, not an import. */
export function isCanaryEntryPoint(argv: readonly string[] = process.argv): boolean {
  const entry = argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

/**
 * Run the canary and return its exit code.
 *
 * Kept as a function with no work at import time: the mode gate above is only
 * meaningful if it can be exercised by a test, and a module that connects to a
 * database merely by being imported cannot be.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  loadDotEnv({ quiet: true });

  const dryRun = argv.includes("--dry-run");
  const maxSegments = Number(argv.find((arg) => arg.startsWith("--max="))?.slice("--max=".length) ?? 8);

  /**
   * The canary's own default. `resolveLexiconIndexingMode()` returns `disabled`
   * when nothing is configured, which is right for production but would make the
   * canary a no-op by accident, so the canary opts itself into observation mode
   * explicitly and says so in the output.
   */
  const decision = resolveCanaryMode(process.env, argv);
  const mode = decision.mode;

  console.log("=== lexicon indexing canary ===");
  console.log(`  ${"mode".padEnd(26)} ${mode}`);
  console.log(
    `  ${"mode source".padEnd(26)} ${
      decision.source === "env"
        ? `${LEXICON_INDEXING_MODE_ENV_KEY}=${decision.configuredValue}`
        : "canary default (env unset)"
    }`,
  );
  console.log(`  ${"dry run".padEnd(26)} ${dryRun}`);
  console.log(`  ${"max segments".padEnd(26)} ${maxSegments}`);
  console.log(`  ${"index confirmed".padEnd(26)} ${argv.includes(CANARY_INDEX_CONFIRMATION_FLAG)}`);

  // A refusal happens before the connection string is read: an unconfirmed
  // `index` run must not be able to write, pay or even read.
  if (decision.refused) {
    console.log("\n--- refused before doing anything ---");
    console.log(`  ${decision.refusal}`);
    console.log("  provider calls     0");
    console.log("  database reads     0");
    console.log("  database writes    0");
    console.log("\nNothing was extracted, reviewed, written or paid for.");
    return 2;
  }

  const connection = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connection) {
    console.log("no database connection string configured");
    return 1;
  }

  const { client, db } = createDatabaseConnection(connection);
  const line = (label: string, value: unknown): void => console.log(`  ${label.padEnd(26)} ${String(value)}`);

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
      return 2;
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
      return 2;
    }

    // ------------------------------------------------------------------ dry run
    if (dryRun) {
      console.log("\n--- dry run ---");
      line("providers constructed", "none");
      line("database writes", "none");
      line("paid calls", 0);
      console.log("\ndry run complete: the article and its segments are readable and usable.");
      return 0;
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
      return 0;
    }

    // ----------------------------------------------------------- the real chain
    const candidates = createDrizzleLexiconCandidateRepository(db);
    const corpus = createDrizzleLexiconCorpusRepository(db);
    const audits = createDrizzleLexiconCandidateApprovalAuditStore(db);

    /**
     * `index` mode approves with the single owner-authorized AI review identity
     * from `review-identity.ts`; `review-only` never approves, so it passes
     * `null` and the pipeline stays incapable of writing the corpus.
     */
    const approvedBy = mode === "index" ? OWNER_AUTHORIZED_REVIEWER_REFERENCE : null;

    // Printed before the providers are even constructed, so a run that turns out
    // to be impossible still shows exactly what it was about to write.
    if (mode === "index") {
      const storedCandidates = (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from lexicon_candidates
              where document_stable_key = ${article.stableKey} and document_version = ${article.version}`,
        )
      )[0]?.n ?? 0;
      const storedApprovals = (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from lexicon_candidate_approvals a
              inner join lexicon_candidates c on c.id = a.candidate_id
              where c.document_stable_key = ${article.stableKey} and c.document_version = ${article.version}`,
        )
      )[0]?.n ?? 0;

      console.log("\n--- what index mode is about to write ---");
      for (const planLine of describeIndexWritePlan({
        stableKey: article.stableKey,
        documentVersion: article.version,
        segmentIndexes: segments.map((segment) => segment.segmentIndex),
        storedCandidates,
        storedApprovals,
        approver: approvedBy ?? "(none)",
      })) {
        console.log(planLine);
      }
      console.log(`  confirmed by        ${CANARY_INDEX_CONFIRMATION_FLAG}`);
      console.log("");
    }

    // Imported lazily so that `--dry-run` and `disabled` never load a module that
    // reads an API key or reaches the network.
    const { createMiniMaxLexiconExtractionProvider } = await import(
      "../src/modules/providers/lexicon-extraction/server"
    );
    const { createMiniMaxCandidateReviewer } = await import("../src/modules/providers/lexicon-review/server");

    const provider = createMiniMaxLexiconExtractionProvider();
    const reviewer = createMiniMaxCandidateReviewer();

    const started = Date.now();
    const result = await runLexiconIndexingPipeline(
      { provider, reviewer, candidates, corpus, audits },
      {
        mode,
        segments,
        approvedBy,
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
          "\nnote: `index` mode needs an owner-authorized approver and the Postgres approval-audit\n" +
            "store. Both are wired into this canary, so this failure means the run input reached the\n" +
            "pipeline without them, not that a store is missing.",
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

      if (mode === "index") {
        // Read back what was actually recorded, so a successful run shows its own
        // audit trail instead of asking the operator to trust the exit code.
        const approvals = (
          await db.execute<{ n: number }>(
            sql`select count(*)::int as n from lexicon_candidate_approvals a
                inner join lexicon_candidates c on c.id = a.candidate_id
                where c.document_stable_key = ${article.stableKey} and c.document_version = ${article.version}`,
          )
        )[0]?.n ?? 0;
        console.log("\n--- approval audit ---");
        line("rows for this version", approvals);
        line("this run indexed", result.counts.indexed);
        console.log(
          `\nread this as: ${result.counts.indexed} candidate(s) were approved by `
            + `${OWNER_AUTHORIZED_REVIEWER_REFERENCE}\nand indexed in this run; every approval has an audit row in `
            + "lexicon_candidate_approvals.",
        );
      } else {
        console.log(
          "\nread this as: `paid calls this run` is the whole cost of the run — one extraction\n" +
            "plus one call per review verdict. Running it again should show a smaller number\n" +
            "for the same article, because verdicts already on record are re-read, not re-bought.",
        );
      }
    }
  } catch (error) {
    console.log("\ncanary failed:");
    console.log(String(error).slice(0, 1_200));
    exitCode = 1;
  } finally {
    await client.end({ timeout: 5 });
  }
  return exitCode;
}

if (isCanaryEntryPoint()) {
  process.exitCode = await main();
}
