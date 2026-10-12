import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import {
  createFakeCandidateReviewer,
  type CandidateReviewer,
} from "@/src/modules/lexicon-corpus/application/candidate-reviewer";
import { recordCandidateReview } from "@/src/modules/lexicon-corpus/application/lexicon-candidate-review";
import {
  resolveLexiconIndexingMode,
  type LexiconIndexingMode,
} from "@/src/modules/lexicon-corpus/application/lexicon-indexing-mode";
import {
  runLexiconIndexingPipeline,
  type LexiconIndexingPipelineDependencies,
  type LexiconIndexingPipelineResult,
  type LexiconIndexingRunInput,
  type LexiconIndexingSegment,
} from "@/src/modules/lexicon-corpus/application/lexicon-indexing-pipeline";
import {
  makeCandidateId,
  submitForReview,
  type LexiconCandidate,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import { createInMemoryLexiconCandidateRepository } from "@/src/modules/lexicon-corpus/repositories/in-memory-lexicon-candidate-repository";
import type {
  LexiconCandidateApprovalAuditStore,
  LexiconCandidateAuditWriteOutcome,
  LexiconCandidateCreateOutcome,
  LexiconCandidateProvenance,
  LexiconCandidateRepository,
  LexiconCandidateSourceKey,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-candidate-repository";
import type {
  LexemeIndexInput,
  LexiconCorpusRepository,
  PhraseIndexInput,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-corpus-repository";
import {
  createFakeLexemeCandidateProvider,
  type LexemeCandidateProvider,
  type LexiconCandidateProposal,
  type LexiconExtractionInput,
  type LexiconExtractionResult,
} from "@/src/modules/providers/lexicon-extraction";

/**
 * LEX-INDEX-001 slice 6: extraction → dual review → approval → indexing, behind
 * a switch that is off by default.
 *
 * Only the fake extraction provider and a fake reviewer are used. No test here
 * opens a socket, reads `MINIMAX_API_KEY`, or touches a database: the candidate
 * store is the in-memory implementation and the corpus is a recording fake, so
 * "how many times was the corpus written" is an assertion, not an inference.
 *
 * The two wrappers that reshape the fake provider's output (an unknown segment
 * index, a lexeme without a lemma) exist only because the fake cannot produce
 * those malformed responses itself; they delegate to
 * `createFakeLexemeCandidateProvider()` and never call a real provider.
 */

const now = new Date("2026-10-10T12:00:00.000Z");
const later = new Date("2026-10-10T13:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;
const REVIEW_DIMENSIONS = ["content-es-ES", "teaching-zh-CN"] as const;

const SOURCE: LexiconCandidateSourceKey = {
  documentKind: "article",
  documentStableKey: "article.a",
  documentVersion: 1,
};

const FAKE_PROVENANCE: LexiconCandidateProvenance = {
  provider: "fake",
  modelVersion: "fake-lexicon-extraction-v1",
  confidence: 100,
};

/** Four proposals: one phrase (the segment carries a translation) and three lexemes. */
const ARTICLE_SEGMENT: LexiconIndexingSegment = {
  documentKind: "article",
  documentStableKey: SOURCE.documentStableKey,
  documentVersion: SOURCE.documentVersion,
  segmentIndex: 0,
  sourceText: "El terremoto llegó a Panamá.",
  translation: "地震抵达了巴拿马。",
  sourceTitle: "Alerta de tsunami",
  sourceKind: "article-rss",
  paragraphId: "p1",
};

/** One lexeme proposal only, for tests that count reviewer calls exactly. */
const SINGLE_SEGMENT: LexiconIndexingSegment = {
  ...ARTICLE_SEGMENT,
  sourceText: "Terremoto",
  translation: null,
};

const MEDIA_SEGMENT: LexiconIndexingSegment = {
  documentKind: "media",
  documentStableKey: "media.podcast-1",
  documentVersion: 3,
  segmentIndex: 7,
  sourceText: "El sismo se sintió en la capital.",
  translation: null,
  sourceTitle: "Noticias de hoy",
  sourceKind: "podcast-rss",
  startMs: 120_000,
  endMs: 126_000,
};

type IndexCall =
  | Readonly<{ kind: "lexeme"; input: LexemeIndexInput; sourceTitle: string; sourceKind: string }>
  | Readonly<{ kind: "phrase"; input: PhraseIndexInput; sourceTitle: string; sourceKind: string }>;

/**
 * A corpus fake that records every index call *and* every other method reached,
 * so a test can prove the pipeline never wandered into another path. The two
 * methods that must never be called throw: `setIntent` mutates a user's shelf and
 * `submitAssessment` writes ability evidence.
 */
function createRecordingCorpus(
  overrides: Partial<LexiconCorpusRepository> = {},
  events: string[] = [],
): Readonly<{ repository: LexiconCorpusRepository; indexCalls: IndexCall[]; methodCalls: string[] }> {
  const indexCalls: IndexCall[] = [];
  const methodCalls: string[] = [];
  const repository: LexiconCorpusRepository = {
    listFrequencyWords: async () => {
      methodCalls.push("listFrequencyWords");
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
    findCorpusExample: async () => {
      methodCalls.push("findCorpusExample");
      return null;
    },
    listVocabulary: async () => {
      methodCalls.push("listVocabulary");
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
    listPhrases: async () => {
      methodCalls.push("listPhrases");
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
    setIntent: async () => {
      methodCalls.push("setIntent");
      throw new Error("setIntent must not be called by the indexing pipeline");
    },
    indexLexeme: async (input, sourceTitle, sourceKind) => {
      methodCalls.push("indexLexeme");
      events.push(`index:lexeme:${input.form}`);
      indexCalls.push({ kind: "lexeme", input, sourceTitle, sourceKind });
      return `lexeme-${indexCalls.length}`;
    },
    indexPhrase: async (input, sourceTitle, sourceKind) => {
      methodCalls.push("indexPhrase");
      events.push(`index:phrase:${input.expression}`);
      indexCalls.push({ kind: "phrase", input, sourceTitle, sourceKind });
      return `phrase-${indexCalls.length}`;
    },
    searchCorpus: async () => {
      methodCalls.push("searchCorpus");
      return { items: [], page: 1, pageSize: 20, total: 0 };
    },
    getAssessment: async () => {
      methodCalls.push("getAssessment");
      return null;
    },
    submitAssessment: async () => {
      methodCalls.push("submitAssessment");
      throw new Error("submitAssessment must not be called: it writes ability evidence");
    },
    ...overrides,
    listCorpusClusters: overrides.listCorpusClusters ?? (async () => ({ items: [], page: 1, pageSize: 8, total: 0 })),
  };
  return { repository, indexCalls, methodCalls };
}

type Store = ReturnType<typeof createInMemoryLexiconCandidateRepository>;

type Harness = Readonly<{
  dependencies: LexiconIndexingPipelineDependencies;
  store: Store;
  corpus: ReturnType<typeof createRecordingCorpus>;
  reviewer: CandidateReviewer;
  extractionInputs: LexiconExtractionInput[];
  /** `create`/`save`/`index` order, so approval-before-index can be asserted. */
  events: string[];
}>;

function createHarness(
  options: Readonly<{
    reviewer?: CandidateReviewer;
    provider?: LexemeCandidateProvider;
    corpus?: ReturnType<typeof createRecordingCorpus>;
    withoutAuditStore?: boolean;
    wrapCandidates?: (base: LexiconCandidateRepository, store: Store) => LexiconCandidateRepository;
    wrapAudits?: (base: LexiconCandidateApprovalAuditStore, store: Store) => LexiconCandidateApprovalAuditStore;
  }> = {},
): Harness {
  const store = createInMemoryLexiconCandidateRepository();
  const events: string[] = [];
  const corpus = options.corpus ?? createRecordingCorpus({}, events);
  const reviewer = options.reviewer ?? createFakeCandidateReviewer({ reviewedAt: now });

  const extractionInputs: LexiconExtractionInput[] = [];
  const baseProvider = options.provider ?? createFakeLexemeCandidateProvider();
  const provider: LexemeCandidateProvider = {
    extractCandidates: async (input, providerOptions) => {
      extractionInputs.push(input);
      return baseProvider.extractCandidates(input, providerOptions);
    },
  };

  const loggingCandidates: LexiconCandidateRepository = {
    ...store,
    create: async (record) => {
      events.push(`create:${record.candidate.id}:${record.candidate.status}`);
      return store.create(record);
    },
    save: async (input) => {
      events.push(`save:${input.candidate.id}:${input.candidate.status}`);
      return store.save(input);
    },
  };

  const candidates = options.wrapCandidates
    ? options.wrapCandidates(loggingCandidates, store)
    : loggingCandidates;
  const audits = options.withoutAuditStore
    ? undefined
    : options.wrapAudits
      ? options.wrapAudits(store, store)
      : store;

  return {
    dependencies: { provider, reviewer, candidates, corpus: corpus.repository, ...(audits ? { audits } : {}) },
    store,
    corpus,
    reviewer,
    extractionInputs,
    events,
  };
}

function run(
  harness: Harness,
  overrides: Partial<LexiconIndexingRunInput> = {},
): Promise<LexiconIndexingPipelineResult> {
  return runLexiconIndexingPipeline(harness.dependencies, {
    mode: "index",
    segments: [ARTICLE_SEGMENT],
    approvedBy: OWNER,
    now: later,
    ...overrides,
  });
}

function expectOk(result: LexiconIndexingPipelineResult): Extract<LexiconIndexingPipelineResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.detail}`);
  return result;
}

function expectFailure(result: LexiconIndexingPipelineResult): Extract<LexiconIndexingPipelineResult, { ok: false }> {
  if (result.ok) throw new Error("expected the run to fail");
  return result;
}

function storedCandidates(store: Store): Promise<readonly { candidate: LexiconCandidate }[]> {
  return store.listBySource(SOURCE);
}

/** A candidate fixture matching the single-lexeme segment, for seeding stored state. */
function seededCandidate(segment: LexiconIndexingSegment, normalizedText: string): LexiconCandidate {
  return {
    id: makeCandidateId({
      kind: "lexeme",
      documentKind: segment.documentKind,
      stableKey: segment.documentStableKey,
      version: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      normalizedText,
    }),
    kind: "lexeme",
    surfaceText: normalizedText === "terremoto" ? "Terremoto" : normalizedText,
    normalizedText,
    lemma: normalizedText,
    partOfSpeech: null,
    meaningZh: null,
    status: "discovered",
    revision: 1,
    source: {
      documentKind: segment.documentKind,
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      contextBefore: "",
      contextAfter: "",
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
    },
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Seed a stored candidate at `review_submitted`, optionally with the Spanish
 * dimension already recorded — the state a crashed run leaves behind.
 */
async function seedSubmitted(store: Store, segment: LexiconIndexingSegment): Promise<string> {
  const created = await store.create({ candidate: seededCandidate(segment, "terremoto"), provenance: FAKE_PROVENANCE });
  if (created.status !== "created") throw new Error(`seed failed: ${created.status}`);

  const submitted = submitForReview(created.record.candidate, { expectedRevision: 1, now });
  if (!submitted.ok) throw new Error(`seed submit failed: ${submitted.conflict}`);
  const saved = await store.save({ candidate: submitted.candidate, expectedRevision: 1 });
  if (saved.status !== "saved") throw new Error(`seed save failed: ${saved.status}`);
  return created.record.candidate.id;
}

async function seedFirstDimension(store: Store, candidateId: string): Promise<void> {
  const stored = await store.findById(candidateId);
  if (!stored) throw new Error("seed: candidate disappeared");
  const recorded = recordCandidateReview(stored.candidate, {
    dimension: "content-es-ES",
    outcome: "pass",
    reviewerReference: OWNER,
    reviewedAt: now,
    expectedRevision: stored.candidate.revision,
    now,
  });
  if (!recorded.ok) throw new Error(`seed review failed: ${recorded.code}`);
  const saved = await store.save({ candidate: recorded.candidate, expectedRevision: stored.candidate.revision });
  if (saved.status !== "saved") throw new Error(`seed review save failed: ${saved.status}`);
}

describe("the switch decides whether the pipeline runs at all (LEX-INDEX-001 slice 6)", () => {
  it("does nothing at all when the switch is missing (the default)", async () => {
    const harness = createHarness();
    // The mode comes from the real resolver over an environment without the key.
    const resolved = resolveLexiconIndexingMode({});
    expect(resolved).toBe("disabled");

    const result = expectOk(await run(harness, { mode: resolved }));

    expect(result.skipped).toBe("disabled");
    expect(result.mode).toBe("disabled");
    expect(result.counts).toEqual({
      extracted: 0,
      deduplicated: 0,
      created: 0,
      existing: 0,
      rejected: 0,
      approved: 0,
      indexed: 0,
      lexemes: 0,
      phrases: 0,
      reviewCalls: 0,
      fixedExpressionMembersDropped: 0,
      fixedExpressionPhrasesAdded: 0,
    });
    expect(result.providerUsage).toEqual({
      called: false,
      provider: null,
      modelVersion: null,
      estimatedCostMicros: null,
    });
    expect(harness.extractionInputs).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    expect(await storedCandidates(harness.store)).toHaveLength(0);
  });

  it("treats an invalid switch value as disabled (fail-closed)", async () => {
    const harness = createHarness();
    const invalidMode = "enabled" as string as LexiconIndexingMode;

    const result = expectOk(await run(harness, { mode: invalidMode, approvedBy: null }));

    expect(result.mode).toBe("disabled");
    expect(result.skipped).toBe("disabled");
    expect(harness.extractionInputs).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
  });

  it("advances candidates to the review library in review-only mode, without indexing", async () => {
    const harness = createHarness();

    const result = expectOk(await run(harness, { mode: "review-only" }));

    expect(result.skipped).toBeNull();
    expect(result.counts.created).toBe(4);
    expect(result.counts.reviewCalls).toBe(8);
    expect(result.counts.approved).toBe(0);
    expect(result.counts.indexed).toBe(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    expect(harness.corpus.methodCalls).toHaveLength(0);

    const stored = await storedCandidates(harness.store);
    expect(stored).toHaveLength(4);
    for (const record of stored) {
      expect(record.candidate.status).toBe("review_ready");
      expect(record.candidate.revision).toBe(4);
      expect(record.candidate.approvedBy).toBeNull();
      expect(record.candidate.approvedAt).toBeNull();
      expect(record.candidate.reviews).toHaveLength(2);
      expect(record.candidate.reviews.map((review) => review.dimension)).toEqual([...REVIEW_DIMENSIONS]);
      expect(record.candidate.reviews.every((review) => review.outcome === "pass")).toBe(true);
    }
  });

  it("ignores an approver in review-only mode: the mode decides, not the input", async () => {
    const harness = createHarness();

    // `approvedBy` is supplied, and still nothing is approved or indexed.
    const result = expectOk(await run(harness, { mode: "review-only", approvedBy: OWNER }));

    expect(result.counts.approved).toBe(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    for (const record of await storedCandidates(harness.store)) {
      expect(record.candidate.approvedBy).toBeNull();
    }
  });

  it("reports an empty segment list as a no-op without calling the provider", async () => {
    const harness = createHarness();

    const result = expectOk(await run(harness, { segments: [] }));

    expect(result.skipped).toBe("no-segments");
    expect(result.mode).toBe("index");
    expect(harness.extractionInputs).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
  });
});

describe("only an approved candidate reaches the corpus (LEX-INDEX-001 slice 6)", () => {
  it("approves and indexes every reviewed candidate exactly once", async () => {
    const harness = createHarness();

    const result = expectOk(await run(harness));

    expect(result.counts).toEqual({
      extracted: 4,
      deduplicated: 0,
      created: 4,
      existing: 0,
      rejected: 0,
      approved: 4,
      indexed: 4,
      lexemes: 3,
      phrases: 1,
      reviewCalls: 8,
      // These segments contain none of the listed fixed expressions, so the rule
      // neither drops a member nor adds a phrase here.
      fixedExpressionMembersDropped: 0,
      fixedExpressionPhrasesAdded: 0,
    });
    expect(result.providerUsage.called).toBe(true);
    expect(result.providerUsage.provider).toBe("fake");
    expect(result.providerUsage.modelVersion).toBe("fake-lexicon-extraction-v1");
    expect(result.providerUsage.estimatedCostMicros).toBe(0);

    // One corpus write per candidate, and nothing else was ever reached.
    expect(harness.corpus.indexCalls.map((call) => call.kind).sort()).toEqual([
      "lexeme",
      "lexeme",
      "lexeme",
      "phrase",
    ]);
    expect(harness.corpus.methodCalls.every((method) => method === "indexLexeme" || method === "indexPhrase")).toBe(true);

    const stored = await storedCandidates(harness.store);
    expect(stored).toHaveLength(4);
    for (const record of stored) {
      expect(record.candidate.status).toBe("approved");
      expect(record.candidate.revision).toBe(5);
      expect(record.candidate.approvedBy).toBe(OWNER);
      expect(record.candidate.approvedAt).toEqual(later);
      expect(record.candidate.reviews).toHaveLength(2);
    }

    // One approval audit per approval, carrying both dimensions (ADR-0011 §5).
    const audits = await harness.store.listApprovalAudits({});
    expect(audits).toHaveLength(4);
    for (const audit of audits) {
      expect(audit.mode).toBe("single");
      expect(audit.batchId).toBeNull();
      expect(audit.approvedBy).toBe(OWNER);
      expect(audit.revision).toBe(5);
      expect(audit.reviews.map((review) => review.dimension)).toEqual([...REVIEW_DIMENSIONS]);
      expect(audit.lexemes + audit.phrases).toBe(1);
    }
  });

  it("never writes the corpus before the candidate's approval is persisted", async () => {
    const harness = createHarness();

    expectOk(await run(harness));

    // Walk the interleaved log: the k-th index call must be preceded by at least
    // k persisted approvals. That is the "only approved" invariant, observed at
    // the only place that can violate it.
    let approvals = 0;
    let indexCalls = 0;
    for (const event of harness.events) {
      if (event.endsWith(":approved")) approvals += 1;
      if (event.startsWith("index:")) {
        indexCalls += 1;
        expect(approvals).toBeGreaterThanOrEqual(indexCalls);
      }
    }
    expect(approvals).toBe(4);
    expect(indexCalls).toBe(4);
  });

  it("indexes the approved lexeme with honest provenance and the frozen position", async () => {
    const harness = createHarness();

    expectOk(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(harness.corpus.indexCalls).toHaveLength(1);
    const call = harness.corpus.indexCalls[0];
    expect(call.kind).toBe("lexeme");
    if (call.kind !== "lexeme") return;
    expect(call.input).toEqual({
      lemma: "terremoto",
      normalizedLemma: "terremoto",
      // `verified` is earned: this candidate passed both dimensions and was approved.
      lemmaStatus: "verified",
      partOfSpeech: null,
      // The fake's synthetic gloss reaches the corpus now. It used to arrive as
      // null, which is precisely what made the teaching dimension reject every
      // lexeme; this assertion is what proves the gloss survives the whole chain.
      // The placeholder echoes the surface form as it appeared in the sentence.
      meaningZh: "〔fake〕Terremoto",
      form: "Terremoto",
      normalizedForm: "terremoto",
      reference: {
        document: { kind: "article", stableKey: "article.a", version: 1 },
        position: { kind: "text", paragraphId: "p1", segmentIndex: 0 },
        sourceText: "Terremoto",
        contextBefore: "",
        contextAfter: "",
      },
    });
    expect(call.sourceTitle).toBe("Alerta de tsunami");
    expect(call.sourceKind).toBe("article-rss");
  });

  it("carries the media position into the corpus reference", async () => {
    const harness = createHarness();

    expectOk(await run(harness, { segments: [MEDIA_SEGMENT] }));

    expect(harness.corpus.indexCalls).toHaveLength(3);
    for (const call of harness.corpus.indexCalls) {
      expect(call.kind).toBe("lexeme");
      if (call.kind !== "lexeme") continue;
      expect(call.input.reference.document).toEqual({ kind: "media", stableKey: "media.podcast-1", version: 3 });
      expect(call.input.reference.position).toEqual({
        kind: "media",
        startMs: 120_000,
        endMs: 126_000,
        segmentIndex: 7,
      });
    }
  });

  it("leaves the corpus untouched for a rejected candidate, in every mode", async () => {
    const harness = createHarness({ reviewer: createFakeCandidateReviewer({ reviewedAt: now, outcomes: { "content-es-ES": "fail" } }) });

    const result = expectOk(await run(harness));

    expect(result.counts.rejected).toBe(4);
    expect(result.counts.approved).toBe(0);
    expect(result.counts.indexed).toBe(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    for (const record of await storedCandidates(harness.store)) {
      expect(record.candidate.status).toBe("rejected");
      expect(record.candidate.rejectedReason).toBe("REVIEW_DIMENSION_FAILED");
      expect(record.candidate.approvedBy).toBeNull();
    }
  });

  it("does not index an already-approved candidate even in index mode", async () => {
    // Drive the candidate to `review_ready` in a review-only run, then approve
    // and index it in a second run: the corpus sees it once, in run two.
    const first = createHarness();
    expectOk(await run(first, { mode: "review-only" }));
    expect(first.corpus.indexCalls).toHaveLength(0);

    const firstRunStore = first.store;
    const second = createHarness({
      wrapCandidates: () => firstRunStore,
      wrapAudits: () => firstRunStore,
    });

    const result = expectOk(await run(second));

    expect(result.counts.existing).toBe(4);
    expect(result.counts.created).toBe(0);
    expect(result.counts.indexed).toBe(4);
    expect(second.corpus.indexCalls).toHaveLength(4);
  });
});

describe("a repeated run is idempotent (LEX-INDEX-001 slice 6)", () => {
  it("does not reset stored state, re-review, re-approve or re-index", async () => {
    const harness = createHarness();

    const first = expectOk(await run(harness));
    expect(first.counts.indexed).toBe(4);
    expect(harness.corpus.indexCalls).toHaveLength(4);
    const afterFirst = await storedCandidates(harness.store);
    const reviewsAfterFirst = afterFirst.map((record) => record.candidate.reviews.length);
    expect(reviewsAfterFirst).toEqual([2, 2, 2, 2]);

    const second = expectOk(await run(harness));

    // `create` hit the existing rows: nothing was inserted, nothing advanced.
    expect(second.counts.created).toBe(0);
    expect(second.counts.existing).toBe(4);
    expect(second.counts.indexed).toBe(0);
    expect(second.counts.approved).toBe(4);
    // No verdict was paid for twice: the stored reviews are already complete.
    expect(second.counts.reviewCalls).toBe(0);
    expect(harness.corpus.indexCalls).toHaveLength(4);

    const afterSecond = await storedCandidates(harness.store);
    expect(afterSecond.map((record) => record.candidate.revision)).toEqual([5, 5, 5, 5]);
    expect(afterSecond.map((record) => record.candidate.reviews.length)).toEqual(reviewsAfterFirst);
    expect(afterSecond.map((record) => record.candidate.approvedBy)).toEqual([OWNER, OWNER, OWNER, OWNER]);
    expect(await harness.store.listApprovalAudits({})).toHaveLength(4);

    // Extraction ran again (the provider is called once per run) but the state did not move.
    expect(harness.extractionInputs).toHaveLength(2);
  });

  it("reviews a half-reviewed candidate only for the missing dimension", async () => {
    const store = createInMemoryLexiconCandidateRepository();
    const candidateId = await seedSubmitted(store, SINGLE_SEGMENT);
    await seedFirstDimension(store, candidateId);
    const reviewer = createFakeCandidateReviewer({ reviewedAt: now });
    const corpus = createRecordingCorpus();
    const harness = createHarness({ reviewer, corpus, wrapCandidates: () => store, wrapAudits: () => store });

    const result = expectOk(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(reviewer.calls).toHaveLength(1);
    expect(reviewer.calls[0]?.dimension).toBe("teaching-zh-CN");
    expect(result.counts.created).toBe(0);
    expect(result.counts.indexed).toBe(1);
    expect(corpus.indexCalls).toHaveLength(1);

    const stored = await store.findById(candidateId);
    expect(stored?.candidate.status).toBe("approved");
    expect(stored?.candidate.reviews.map((review) => review.dimension)).toEqual([...REVIEW_DIMENSIONS]);
  });

  it("never revives a rejected candidate, even with a passing re-review", async () => {
    const store = createInMemoryLexiconCandidateRepository();
    const failing = createHarness({
      wrapCandidates: () => store,
      wrapAudits: () => store,
      reviewer: createFakeCandidateReviewer({ reviewedAt: now, outcomes: { "teaching-zh-CN": "fail" } }),
    });
    const first = expectOk(await run(failing, { segments: [SINGLE_SEGMENT] }));
    expect(first.counts.rejected).toBe(1);
    const rejected = first.candidates[0];
    if (!rejected) throw new Error("expected one candidate outcome");
    // Spanish dimension passed (revision 3), the teaching dimension failed (4).
    expect(rejected.status).toBe("rejected");
    expect(rejected.revision).toBe(4);

    const passing = createHarness({ wrapCandidates: () => store, wrapAudits: () => store });
    const second = expectOk(await run(passing, { segments: [SINGLE_SEGMENT] }));

    // Rejection is terminal: the fresh passing verdict changes nothing.
    expect(second.counts.reviewCalls).toBe(0);
    expect(second.counts.indexed).toBe(0);
    expect(passing.corpus.indexCalls).toHaveLength(0);
    const stored = await store.findById(rejected.candidateId);
    expect(stored?.candidate.status).toBe("rejected");
    expect(stored?.candidate.revision).toBe(4);
    expect(stored?.candidate.approvedBy).toBeNull();
  });

  it("folds a repeated surface form onto one candidate identity", async () => {
    const harness = createHarness();
    const repeated: LexiconIndexingSegment = {
      ...ARTICLE_SEGMENT,
      sourceText: "Terremoto en Panamá. El terremoto llegó.",
      translation: null,
    };

    const result = expectOk(await run(harness, { segments: [repeated] }));

    // Four proposals, three identities: "Terremoto" and "terremoto" are one candidate.
    expect(result.counts.extracted).toBe(4);
    expect(result.counts.deduplicated).toBe(1);
    expect(result.counts.created).toBe(3);
    expect(result.counts.reviewCalls).toBe(6);
    expect(harness.corpus.indexCalls).toHaveLength(3);
    expect(await storedCandidates(harness.store)).toHaveLength(3);
  });
});

describe("failures leave no partial state and write no evidence (LEX-INDEX-001 slice 6)", () => {
  it("aborts on a thrown extraction with zero writes", async () => {
    const failing: LexemeCandidateProvider = {
      extractCandidates: async () => {
        throw new Error("provider exploded");
      },
    };
    const harness = createHarness({ provider: failing });

    const failure = expectFailure(await run(harness));

    expect(failure.code).toBe("INDEXING_EXTRACTION_FAILED");
    expect(failure.detail).toBe("Error: provider exploded");
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    expect(await storedCandidates(harness.store)).toHaveLength(0);
  });

  it("aborts on a thrown review with zero writes", async () => {
    const harness = createHarness({
      reviewer: createFakeCandidateReviewer({ reviewedAt: now, error: new Error("reviewer offline") }),
    });

    const failure = expectFailure(await run(harness));

    expect(failure.code).toBe("INDEXING_REVIEW_FAILED");
    expect(failure.detail).toBe("content-es-ES: Error: reviewer offline");
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
    expect(await storedCandidates(harness.store)).toHaveLength(0);
  });

  it("refuses a verdict from an unauthorised reviewer before writing anything", async () => {
    const harness = createHarness({
      reviewer: createFakeCandidateReviewer({ reviewedAt: now, reviewerReference: "owner" }),
    });

    const failure = expectFailure(await run(harness));

    expect(failure.code).toBe("INDEXING_REVIEW_INVALID");
    expect(failure.detail).toBe("content-es-ES: Reviewer reference is not owner-authorized.");
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
  });

  it("refuses a verdict for a dimension that was not requested", async () => {
    const harness = createHarness({
      reviewer: createFakeCandidateReviewer({
        reviewedAt: now,
        respond: (input) => ({
          dimension: input.dimension === "content-es-ES" ? "teaching-zh-CN" : "content-es-ES",
          outcome: "pass",
          reviewerReference: OWNER,
          reviewedAt: now,
        }),
      }),
    });

    const failure = expectFailure(await run(harness));

    expect(failure.code).toBe("INDEXING_REVIEW_INVALID");
    expect(failure.detail).toContain("Reviewer answered \"teaching-zh-CN\" for the \"content-es-ES\" dimension.");
    expect(harness.events).toHaveLength(0);
  });

  it("refuses to contradict a verdict that landed between planning and commit", async () => {
    // A crash left the Spanish dimension on record. The planning read is blinded,
    // as it would be if a concurrent writer had landed that verdict in between,
    // so the fresh failing verdict arrives for a dimension that is already
    // append-only evidence. Silently keeping the old verdict would stall the
    // candidate forever, so the run is refused instead.
    const seedStore = createInMemoryLexiconCandidateRepository();
    const candidateId = await seedSubmitted(seedStore, SINGLE_SEGMENT);
    await seedFirstDimension(seedStore, candidateId);
    const corpus = createRecordingCorpus();

    const dependencies: LexiconIndexingPipelineDependencies = {
      provider: createFakeLexemeCandidateProvider(),
      reviewer: createFakeCandidateReviewer({ reviewedAt: now, outcomes: { "content-es-ES": "fail" } }),
      candidates: {
        ...seedStore,
        findById: async () => null,
        create: async (): Promise<LexiconCandidateCreateOutcome> => {
          const record = await seedStore.findById(candidateId);
          if (!record) throw new Error("seeded candidate disappeared");
          return { status: "exists", record };
        },
        save: (input) => seedStore.save(input),
      },
      corpus: corpus.repository,
      audits: seedStore,
    };

    const failure = expectFailure(
      await runLexiconIndexingPipeline(dependencies, {
        mode: "index",
        segments: [SINGLE_SEGMENT],
        approvedBy: OWNER,
        now: later,
      }),
    );

    expect(failure.code).toBe("INDEXING_REVIEW_INVALID");
    expect(failure.detail).toContain("A \"pass\" verdict for content-es-ES is already on record");
    expect(failure.candidateId).toBe(candidateId);
    expect(corpus.indexCalls).toHaveLength(0);

    const stored = await seedStore.findById(candidateId);
    expect(stored?.candidate.status).toBe("review_submitted");
    expect(stored?.candidate.revision).toBe(3);
    expect(stored?.candidate.reviews).toHaveLength(1);
  });

  it("refuses a proposal that names a segment outside the run", async () => {
    const base = createFakeLexemeCandidateProvider();
    const hostile: LexemeCandidateProvider = {
      extractCandidates: async (input, options): Promise<LexiconExtractionResult> => {
        const result = await base.extractCandidates(input, options);
        const proposals: LexiconCandidateProposal[] = result.proposals.map((proposal) => ({
          ...proposal,
          segmentIndex: 99,
        }));
        return { ...result, proposals };
      },
    };
    const harness = createHarness({ provider: hostile });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_PROPOSAL_INVALID");
    expect(failure.detail).toBe("Proposal references segment 99, which is not part of this run.");
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
  });

  it("refuses, before approving, a lexeme that carries no lemma to index", async () => {
    const base = createFakeLexemeCandidateProvider();
    const hostile: LexemeCandidateProvider = {
      extractCandidates: async (input, options): Promise<LexiconExtractionResult> => {
        const result = await base.extractCandidates(input, options);
        return { ...result, proposals: result.proposals.map((proposal) => ({ ...proposal, lemma: null })) };
      },
    };
    const harness = createHarness({ provider: hostile });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_PROPOSAL_INVALID");
    expect(failure.detail).toContain("has no lemma to index");
    // Nothing was approved for a corpus write that could never succeed.
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);
  });

  it("reports a repository rejection instead of writing around it", async () => {
    const harness = createHarness({
      wrapCandidates: (base) => ({
        ...base,
        create: async (): Promise<LexiconCandidateCreateOutcome> => ({
          status: "rejected",
          code: "CANDIDATE_PROVENANCE_INVALID",
          candidateId: "candidate",
          detail: "test double",
        }),
      }),
    });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_PERSISTENCE_FAILED");
    expect(failure.detail).toBe("CANDIDATE_PROVENANCE_INVALID: test double");
    expect(harness.corpus.indexCalls).toHaveLength(0);
  });

  it("lets a concurrent writer win the compare-and-swap instead of resetting its state", async () => {
    const harness = createHarness({
      wrapCandidates: (base) => ({
        ...base,
        create: async (record): Promise<LexiconCandidateCreateOutcome> => {
          const outcome = await base.create(record);
          if (outcome.status === "created") {
            // Another writer submits the candidate between our insert and our save.
            const submitted = submitForReview(outcome.record.candidate, { expectedRevision: 1, now: later });
            if (submitted.ok) await base.save({ candidate: submitted.candidate, expectedRevision: 1 });
          }
          return outcome;
        },
      }),
    });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_PERSISTENCE_FAILED");
    expect(failure.detail).toContain("CANDIDATE_REVISION_CONFLICT");
    expect(harness.corpus.indexCalls).toHaveLength(0);

    // The newer state is intact: the pipeline did not overwrite it.
    const stored = await storedCandidates(harness.store);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.candidate.status).toBe("review_submitted");
    expect(stored[0]?.candidate.revision).toBe(2);
  });

  it("reports a corpus write failure after the approval is on record", async () => {
    const harness = createHarness({
      corpus: createRecordingCorpus({
        indexLexeme: async () => {
          throw new Error("corpus unavailable");
        },
      }),
    });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_CORPUS_WRITE_FAILED");
    expect(failure.detail).toBe("Error: corpus unavailable");

    const stored = await storedCandidates(harness.store);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.candidate.status).toBe("approved");
    expect(stored[0]?.candidate.revision).toBe(5);
    // No corpus row and no audit: the approval is the only thing that landed.
    expect(await harness.store.listApprovalAudits({})).toHaveLength(0);
  });

  it("reports an audit that cannot be appended", async () => {
    const harness = createHarness({
      wrapAudits: (base) => ({
        ...base,
        insertApprovalAudit: async (): Promise<LexiconCandidateAuditWriteOutcome> => ({
          status: "rejected",
          code: "CANDIDATE_AUDIT_MODE_INCONSISTENT",
          detail: "test double",
        }),
      }),
    });

    const failure = expectFailure(await run(harness, { segments: [SINGLE_SEGMENT] }));

    expect(failure.code).toBe("INDEXING_AUDIT_FAILED");
    expect(failure.detail).toBe("CANDIDATE_AUDIT_MODE_INCONSISTENT: test double");
    // The corpus write happened before the audit: reported, not hidden.
    expect(harness.corpus.indexCalls).toHaveLength(1);
  });

  it("cancels before extraction when the signal is already aborted", async () => {
    const harness = createHarness();
    const controller = new AbortController();
    controller.abort();

    const failure = expectFailure(await run(harness, { signal: controller.signal }));

    expect(failure.code).toBe("INDEXING_RUN_CANCELLED");
    expect(harness.extractionInputs).toHaveLength(0);
    expect(harness.events).toHaveLength(0);
    expect(harness.corpus.indexCalls).toHaveLength(0);

    // The signal is handed to the provider as well, so a real adapter can stop early.
    const after = createHarness();
    expectOk(await run(after, { signal: new AbortController().signal }));
    expect(after.extractionInputs).toHaveLength(1);
  });
});

describe("the run configuration is validated before any work (LEX-INDEX-001 slice 6)", () => {
  it("refuses index mode without an owner-authorized approver", async () => {
    for (const approvedBy of [undefined, null, "", "   ", "owner", "dsh-ai-owner-authorized", "codex-ai-temporary-review"]) {
      const harness = createHarness();
      const failure = expectFailure(await run(harness, { approvedBy }));

      expect(failure.code).toBe("INDEXING_APPROVER_NOT_AUTHORIZED");
      expect(harness.extractionInputs).toHaveLength(0);
      expect(harness.events).toHaveLength(0);
      expect(harness.corpus.indexCalls).toHaveLength(0);
    }
  });

  it("accepts the historical owner-authorised reference as well", async () => {
    // The publication gate reads both identities; indexing must not diverge.
    const harness = createHarness();

    const result = expectOk(
      await run(harness, { segments: [SINGLE_SEGMENT], approvedBy: "codex-ai-owner-authorized-review" }),
    );

    expect(result.counts.indexed).toBe(1);
    expect(await harness.store.listApprovalAudits({})).toHaveLength(1);
  });

  it("refuses index mode without an approval-audit store", async () => {
    const harness = createHarness({ withoutAuditStore: true });

    const failure = expectFailure(await run(harness));

    expect(failure.code).toBe("INDEXING_AUDIT_STORE_MISSING");
    expect(harness.extractionInputs).toHaveLength(0);
    expect(harness.events).toHaveLength(0);

    // review-only needs no audit store: it never approves anything.
    const reviewOnly = createHarness({ withoutAuditStore: true });
    expectOk(await run(reviewOnly, { mode: "review-only" }));
    expect(await storedCandidates(reviewOnly.store)).toHaveLength(4);
  });

  it("refuses an unusable run clock or candidate bound", async () => {
    const invalidDate = new Date(Number.NaN);
    for (const overrides of [{ now: invalidDate }, { maxCandidatesPerSegment: 0 }, { maxCandidatesPerSegment: 1.5 }]) {
      const harness = createHarness();
      const failure = expectFailure(await run(harness, overrides));

      expect(failure.code).toBe("INDEXING_RUN_INPUT_INVALID");
      expect(harness.extractionInputs).toHaveLength(0);
      expect(harness.events).toHaveLength(0);
    }
  });

  it("refuses a run that mixes documents or repeats a segment index", async () => {
    const mixedVersion: LexiconIndexingSegment = { ...ARTICLE_SEGMENT, documentVersion: 2 };
    const mixedKind: LexiconIndexingSegment = { ...MEDIA_SEGMENT, segmentIndex: 0 };
    const duplicateIndex: LexiconIndexingSegment = { ...ARTICLE_SEGMENT };

    for (const segments of [
      [ARTICLE_SEGMENT, mixedVersion],
      [ARTICLE_SEGMENT, mixedKind],
      [ARTICLE_SEGMENT, duplicateIndex],
    ]) {
      const harness = createHarness();
      const failure = expectFailure(await run(harness, { segments }));

      expect(failure.code).toBe("INDEXING_RUN_INPUT_INVALID");
      expect(harness.extractionInputs).toHaveLength(0);
      expect(harness.events).toHaveLength(0);
    }
  });
});

describe("the pipeline cannot write ability evidence (LEX-INDEX-001 slice 6)", () => {
  it("never reaches the assessment path in a full run", async () => {
    const harness = createHarness();

    expectOk(await run(harness));

    // `submitAssessment` is the corpus repository's only evidence-writing method;
    // the recording fake would have thrown (and recorded) if it had been called.
    expect(harness.corpus.methodCalls).not.toContain("submitAssessment");
    expect(harness.corpus.methodCalls).not.toContain("setIntent");
    expect(harness.corpus.methodCalls.every((method) => method.startsWith("index"))).toBe(true);
  });

  it("imports no evidence module and no server-only provider adapter", () => {
    const applicationDirectory = path.resolve(process.cwd(), "src", "modules", "lexicon-corpus", "application");
    const sources = [
      readFileSync(path.join(applicationDirectory, "lexicon-indexing-pipeline.ts"), "utf8"),
      readFileSync(path.join(applicationDirectory, "lexicon-indexing-mode.ts"), "utf8"),
      readFileSync(path.join(applicationDirectory, "candidate-reviewer.ts"), "utf8"),
    ];

    const importedModules = sources.flatMap((source) =>
      [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1] ?? ""),
    );
    // Guards the scan itself: a regex that silently matched nothing would make
    // this test vacuous.
    expect(importedModules.length).toBeGreaterThan(0);
    expect(importedModules).toContain("@/src/modules/content-acquisition/domain/review-identity");
    for (const modulePath of importedModules) {
      expect(modulePath).not.toMatch(/evidence|assessment|server|minimax/iu);
    }
  });
});

/**
 * The fixed-expression rule, at the level where it has to hold: the pipeline.
 *
 * `repente` is the case that produced the rule — extraction proposed it as a
 * NOUN, the reviewer failed it for being part of an adverbial phrase, and the
 * candidate settled as `rejected`. Neither of those steps is wrong; the proposal
 * should never have existed. These tests pin the two halves of the answer: the
 * member is not a candidate at all, and the expression is one.
 */
describe("fixed expressions are candidates; their non-independent members are not", () => {
  const REPENTE_SEGMENT: LexiconIndexingSegment = {
    ...ARTICLE_SEGMENT,
    sourceText: "De repente, un grupo de droides aparece al final del pasillo.",
  };

  function memberProvider(): LexemeCandidateProvider {
    const base = createFakeLexemeCandidateProvider();
    return {
      extractCandidates: async (input, providerOptions) => {
        const result = await base.extractCandidates(input, providerOptions);
        return {
          ...result,
          proposals: [{
            kind: "lexeme" as const,
            surfaceText: "repente",
            normalizedText: "repente",
            lemma: "repente",
            partOfSpeech: "NOUN",
            meaningZh: "突然",
            segmentIndex: 0,
            confidence: 0.9,
          }],
        };
      },
    };
  }

  it("drops the member and proposes the expression instead, before any review call", async () => {
    const testHarness = createHarness({ provider: memberProvider() });
    const result = expectOk(await run(testHarness, {
      mode: "review-only",
      approvedBy: null,
      segments: [REPENTE_SEGMENT],
    }));

    expect(result.counts.fixedExpressionMembersDropped).toBe(1);
    expect(result.counts.fixedExpressionPhrasesAdded).toBe(1);
    // One phrase candidate, so exactly two review calls — the dropped member was
    // never reviewed, which is the point of deciding this before paying.
    expect(result.counts.reviewCalls).toBe(2);

    const stored = await storedCandidates(testHarness.store);
    expect(stored.map((record) => `${record.candidate.kind}:${record.candidate.normalizedText}`)).toEqual([
      "phrase:de repente",
    ]);
    // The expression carries the surface the published segment contains.
    expect(stored[0]?.candidate.surfaceText).toBe("De repente");
  });

  it("still reaches review_ready without approving anything", async () => {
    const testHarness = createHarness({ provider: memberProvider() });
    const result = expectOk(await run(testHarness, {
      mode: "review-only",
      approvedBy: null,
      segments: [REPENTE_SEGMENT],
    }));

    expect(result.candidates.map((candidate) => candidate.status)).toEqual(["review_ready"]);
    expect(result.counts.approved).toBe(0);
    expect(result.counts.indexed).toBe(0);
  });

  it("leaves a member proposal alone when the expression is not in the segment", async () => {
    const testHarness = createHarness({ provider: memberProvider() });
    const result = expectOk(await run(testHarness, {
      mode: "review-only",
      approvedBy: null,
      segments: [{ ...ARTICLE_SEGMENT, sourceText: "El repente de la puerta asustó a todos." }],
    }));

    expect(result.counts.fixedExpressionMembersDropped).toBe(0);
    expect(result.counts.fixedExpressionPhrasesAdded).toBe(0);
    const stored = await storedCandidates(testHarness.store);
    expect(stored.map((record) => `${record.candidate.kind}:${record.candidate.normalizedText}`)).toEqual([
      "lexeme:repente",
    ]);
  });
});
