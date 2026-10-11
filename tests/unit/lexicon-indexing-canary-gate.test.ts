// @vitest-environment node

import path from "node:path";

import { describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import {
  CANARY_INDEX_CONFIRMATION_FLAG,
  describeIndexWritePlan,
  isCanaryEntryPoint,
  main,
  resolveCanaryMode,
} from "../../scripts/lexicon-indexing-canary";

/**
 * The canary's `index` gate.
 *
 * `index` mode writes to the real corpus, so the interesting behaviour is not
 * what it does when it runs — it is what it refuses to do. Two independent inputs
 * must agree before a write is possible: the environment switch and an explicit
 * confirmation argument on the command line. These cases lock that, and lock the
 * pre-write summary an operator is shown before anything changes.
 *
 * Importing the canary module must stay side-effect free (no dotenv load, no
 * database connection); if that ever regresses, this file cannot even run.
 */

const INDEX_ARGS = [CANARY_INDEX_CONFIRMATION_FLAG] as const;

describe("canary index-mode gate", () => {
  it("defaults to review-only when nothing is configured", () => {
    const decision = resolveCanaryMode({}, []);
    expect(decision).toEqual({
      mode: "review-only",
      source: "canary-default",
      configuredValue: null,
      refused: false,
      refusal: null,
    });
  });

  it("refuses index mode without the confirmation argument", () => {
    const decision = resolveCanaryMode({ LEXICON_INDEXING_MODE: "index" }, []);
    expect(decision.mode).toBe("index");
    expect(decision.source).toBe("env");
    expect(decision.refused).toBe(true);
    // The refusal has to name the exact argument, or an operator cannot act on it.
    expect(decision.refusal).toContain(CANARY_INDEX_CONFIRMATION_FLAG);
    expect(decision.refusal).toContain("LEXICON_INDEXING_MODE");
  });

  it("allows index mode only when the environment and the argument agree", () => {
    const decision = resolveCanaryMode({ LEXICON_INDEXING_MODE: "index" }, [...INDEX_ARGS]);
    expect(decision.mode).toBe("index");
    expect(decision.refused).toBe(false);
    expect(decision.refusal).toBeNull();
  });

  it("treats the confirmation argument as inert unless index mode was configured", () => {
    for (const configured of [undefined, "review-only", "disabled", "true", "yes"]) {
      const environment = configured === undefined ? {} : { LEXICON_INDEXING_MODE: configured };
      const decision = resolveCanaryMode(environment, [...INDEX_ARGS]);
      expect(decision.refused).toBe(false);
      expect(decision.mode === "index").toBe(false);
    }
  });

  it("normalises the configured value and still refuses an unconfirmed index", () => {
    const decision = resolveCanaryMode({ LEXICON_INDEXING_MODE: "  INDEX " }, []);
    expect(decision.mode).toBe("index");
    expect(decision.refused).toBe(true);

    const confirmed = resolveCanaryMode({ LEXICON_INDEXING_MODE: "  INDEX " }, [...INDEX_ARGS]);
    expect(confirmed.mode).toBe("index");
    expect(confirmed.refused).toBe(false);
  });

  it("keeps an unrecognised value fail-closed and never refuses for it", () => {
    // A typo must not read as "asked for indexing but unconfirmed": it is simply
    // not indexing, which is the safe direction.
    const decision = resolveCanaryMode({ LEXICON_INDEXING_MODE: "indexing" }, []);
    expect(decision.mode).toBe("disabled");
    expect(decision.source).toBe("env");
    expect(decision.refused).toBe(false);
  });

  it("prints what index mode is about to write, including the AI approver identity", () => {
    const lines = describeIndexWritePlan({
      stableKey: "article.canary",
      documentVersion: 3,
      segmentIndexes: [0, 1, 2],
      storedCandidates: 4,
      storedApprovals: 2,
      approver: OWNER_AUTHORIZED_REVIEWER_REFERENCE,
    });
    const text = lines.join("\n");

    expect(text).toContain("article.canary v3");
    expect(text).toContain("3 (0, 1, 2)");
    expect(text).toContain(OWNER_AUTHORIZED_REVIEWER_REFERENCE);
    // The identity is stated for what it is (AGENTS.md §8): an agent-platform
    // review, never a human, native-speaker or teaching-expert sign-off.
    expect(text).toMatch(/not a human/i);
    expect(text).toMatch(/native-speaker/i);
    expect(text).toMatch(/teaching-expert/i);
    // The tables that will change, and the ones that never will.
    for (const table of [
      "lexicon_candidates",
      "lexicon_candidate_approvals",
      "lexemes",
      "phrase_entries",
      "corpus_occurrences",
    ]) {
      expect(text).toContain(table);
    }
    expect(text).toContain("evidence_events");
    // Existing state is shown so the operator can predict the size of the write.
    expect(text).toContain("4 candidate row(s), 2 approval audit row(s)");
    // And it is explicit that this is not a dry run.
    expect(text).toMatch(/WILL WRITE/);
    expect(text).toMatch(/nothing is rolled back/i);
  });

  it("says so when a run has no segments to describe", () => {
    const text = describeIndexWritePlan({
      stableKey: "article.canary",
      documentVersion: 1,
      segmentIndexes: [],
      storedCandidates: 0,
      storedApprovals: 0,
      approver: OWNER_AUTHORIZED_REVIEWER_REFERENCE,
    }).join("\n");
    expect(text).toContain("0 (none)");
  });

  it("is importable without running: nothing happens until it is the entry point", () => {
    // `main` is exported rather than invoked at import time, which is what lets
    // this file exist at all; if the module ran on import, the tests above would
    // have tried to connect to a database.
    expect(typeof main).toBe("function");
    expect(isCanaryEntryPoint(["node", "vitest"])).toBe(false);
    expect(isCanaryEntryPoint([])).toBe(false);
    expect(isCanaryEntryPoint(["node", path.join(process.cwd(), "scripts", "lexicon-indexing-canary.ts")])).toBe(true);
  });
});
