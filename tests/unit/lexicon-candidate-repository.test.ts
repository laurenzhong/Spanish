import { describe, expect, it } from "vitest";

import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import {
  approveCandidateAndIndex,
  approveCandidateBatch,
  indexApprovedCandidate,
  type LexiconCandidateFrozenSource,
} from "@/src/modules/lexicon-corpus/application/approve-candidate-indexing";
import {
  approveCandidate,
  isIndexable,
  makeCandidateId,
  recordReview,
  submitForReview,
  type LexiconCandidate,
  type LexiconCandidateReview,
  type LexiconCandidateSource,
  type LexiconCandidateStatus,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
import { createInMemoryLexiconCandidateRepository } from "@/src/modules/lexicon-corpus/repositories/in-memory-lexicon-candidate-repository";
import {
  type LexiconCandidateApprovalRecord,
  type LexiconCandidateCreateOutcome,
  type LexiconCandidateProvenance,
  type LexiconCandidateRecord,
  type LexiconCandidateSaveOutcome,
  type LexiconCandidateSourceKey,
  type LexiconCandidateWriteRejectionCode,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-candidate-repository";
import type {
  LexemeIndexInput,
  LexiconCorpusRepository,
  PhraseIndexInput,
} from "@/src/modules/lexicon-corpus/repositories/lexicon-corpus-repository";
import {
  createFakeLexemeCandidateProvider,
  fakeSegment,
  type LexiconCandidateProposal,
  type LexiconExtractionSegment,
} from "@/src/modules/providers/lexicon-extraction";

/**
 * LEX-INDEX-001 slice 6 prerequisite: candidate persistence.
 *
 * The point of this suite is the compare-and-swap on `revision`. A candidate
 * snapshot is a precondition, not a suggestion: a write carrying a stale
 * revision must come back as a conflict and must leave the newer stored state
 * completely untouched. Everything else here (idempotent approval, the
 * indexable-only query, one audit record per candidate) is locked the same way.
 *
 * Only the in-memory implementation is exercised. The Postgres implementation is
 * code-only in this slice: its migration is deliberately unapplied and no
 * database validation has been performed.
 */

const now = new Date("2026-10-10T12:00:00.000Z");
const later = new Date("2026-10-10T13:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;
const DIMENSIONS = ["content-es-ES", "teaching-zh-CN"] as const;

const SOURCE: LexiconCandidateSourceKey = {
  documentKind: "article",
  documentStableKey: "article.a",
  documentVersion: 1,
};

const FROZEN: LexiconCandidateFrozenSource = {
  documentKind: "article",
  documentStableKey: SOURCE.documentStableKey,
  documentVersion: SOURCE.documentVersion,
  segmentIndex: 0,
  sourceText: "Y en Panamá un terremoto de magnitud 7.2 acudió el sureste del país.",
  sourceTitle: "Alerta de tsunami",
  sourceKind: "article-rss",
  paragraphId: "p1",
};

const FAKE_PROVENANCE: LexiconCandidateProvenance = {
  provider: "fake",
  modelVersion: "fake-lexicon-extraction-v1",
  confidence: 100,
};

function source(overrides: Partial<LexiconCandidateSource> = {}): LexiconCandidateSource {
  return {
    documentKind: "article",
    documentStableKey: "article.a",
    documentVersion: 1,
    segmentIndex: 0,
    contextBefore: "Y en Panamá, un ",
    contextAfter: " de magnitud 7.2",
    sourceTitle: "Alerta de tsunami",
    sourceKind: "article-rss",
    ...overrides,
  };
}

const candidateDefaults: Omit<LexiconCandidate, "id"> = {
  kind: "lexeme",
  surfaceText: "terremoto",
  normalizedText: "terremoto",
  lemma: "terremoto",
  partOfSpeech: "NOUN",
  meaningZh: null,
  status: "discovered",
  revision: 1,
  source: source(),
  reviews: [],
  approvedBy: null,
  approvedAt: null,
  rejectedReason: null,
  createdAt: now,
  updatedAt: now,
};

/**
 * A candidate whose `id` is derived from its own fields, exactly as the
 * extraction pipeline builds it (`makeCandidateId()`, the domain's rule).
 */
function candidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  const merged = { ...candidateDefaults, ...overrides };
  return {
    ...merged,
    id: overrides.id ?? makeCandidateId({
      kind: merged.kind,
      documentKind: merged.source.documentKind,
      stableKey: merged.source.documentStableKey,
      version: merged.source.documentVersion,
      segmentIndex: merged.source.segmentIndex,
      normalizedText: merged.normalizedText,
    }),
  };
}

type CorpusWrite =
  | Readonly<{ kind: "lexeme"; input: LexemeIndexInput }>
  | Readonly<{ kind: "phrase"; input: PhraseIndexInput }>;

type RecordingRepository = Readonly<{
  repository: LexiconCorpusRepository;
  calls: readonly CorpusWrite[];
}>;

/**
 * Records every corpus write; every other method throws or returns empty, so a
 * test that accidentally depends on one fails loudly instead of passing.
 */
function createRecordingRepository(): RecordingRepository {
  const calls: ({ kind: "lexeme"; input: LexemeIndexInput } | { kind: "phrase"; input: PhraseIndexInput })[] = [];
  const repository: LexiconCorpusRepository = {
    listFrequencyWords: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    findCorpusExample: async () => null,
    listVocabulary: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    listPhrases: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    setIntent: async () => {
      throw new Error("setIntent must not be called by the candidate store");
    },
    indexLexeme: async (input) => {
      calls.push({ kind: "lexeme", input });
      return `lexeme-${calls.length}`;
    },
    indexPhrase: async (input) => {
      calls.push({ kind: "phrase", input });
      return `phrase-${calls.length}`;
    },
    searchCorpus: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    getAssessment: async () => null,
    submitAssessment: async () => {
      throw new Error("submitAssessment must not be called by the candidate store");
    },
  };
  return { repository, calls };
}

function mustSave(outcome: LexiconCandidateSaveOutcome): LexiconCandidateRecord {
  if (outcome.status !== "saved") throw new Error(`expected a saved write, got ${outcome.status}`);
  return outcome.record;
}

async function createStored(
  repository: ReturnType<typeof createInMemoryLexiconCandidateRepository>,
  overrides: Partial<LexiconCandidate> = {},
  provenance: LexiconCandidateProvenance = FAKE_PROVENANCE,
): Promise<LexiconCandidateRecord> {
  const outcome = await repository.create({ candidate: candidate(overrides), provenance });
  if (outcome.status !== "created") throw new Error(`expected a created record, got ${outcome.status}`);
  return outcome.record;
}

/** Apply one domain transition and store it through the CAS write. */
async function saveTransition(
  repository: ReturnType<typeof createInMemoryLexiconCandidateRepository>,
  stored: LexiconCandidateRecord,
  transition:
    | ReturnType<typeof submitForReview>
    | ReturnType<typeof recordReview>
    | ReturnType<typeof approveCandidate>,
): Promise<LexiconCandidateRecord> {
  if (!transition.ok) throw new Error(`domain transition refused: ${transition.conflict}`);
  return mustSave(await repository.save({
    candidate: transition.candidate,
    expectedRevision: stored.candidate.revision,
  }));
}

function review(dimension: (typeof DIMENSIONS)[number], outcome: "pass" | "fail"): LexiconCandidateReview {
  return { dimension, outcome, reviewerReference: OWNER, reviewedAt: now };
}

/**
 * Drive a candidate to a status through the real domain transitions, persisting
 * every step with compare-and-swap. Nothing is written into the store directly,
 * so the fixtures obey the same rules a production caller would.
 */
async function storedAtStatus(
  repository: ReturnType<typeof createInMemoryLexiconCandidateRepository>,
  status: LexiconCandidateStatus,
  overrides: Partial<LexiconCandidate> = {},
): Promise<LexiconCandidateRecord> {
  let stored = await createStored(repository, overrides);
  if (status === "discovered") return stored;

  stored = await saveTransition(
    repository,
    stored,
    submitForReview(stored.candidate, { expectedRevision: stored.candidate.revision, now }),
  );
  if (status === "review_submitted") return stored;

  if (status === "rejected") {
    return saveTransition(
      repository,
      stored,
      recordReview(stored.candidate, {
        review: review("content-es-ES", "fail"),
        expectedRevision: stored.candidate.revision,
        now,
      }),
    );
  }

  for (const dimension of DIMENSIONS) {
    stored = await saveTransition(
      repository,
      stored,
      recordReview(stored.candidate, {
        review: review(dimension, "pass"),
        expectedRevision: stored.candidate.revision,
        now,
      }),
    );
  }
  if (status === "review_ready") return stored;

  return saveTransition(
    repository,
    stored,
    approveCandidate(stored.candidate, {
      approvedBy: OWNER,
      expectedRevision: stored.candidate.revision,
      now: later,
    }),
  );
}

function rejectionCode(
  outcome: LexiconCandidateCreateOutcome | LexiconCandidateSaveOutcome,
): LexiconCandidateWriteRejectionCode {
  if (outcome.status !== "rejected") throw new Error(`expected a rejection, got ${outcome.status}`);
  return outcome.code;
}

describe("candidate persistence: compare-and-swap on revision", () => {
  it("stores a discovered candidate and reads it back by derived id", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const created = await createStored(repository);

    expect(created.candidate.status).toBe("discovered");
    expect(created.candidate.revision).toBe(1);
    expect(created.provenance).toEqual(FAKE_PROVENANCE);

    const loaded = await repository.findById(created.candidate.id);
    expect(loaded).toEqual(created);
    expect(await repository.findById("lexeme|article.a|1|0|no-existe")).toBeNull();
  });

  it("returns a conflict for a stale revision and never overwrites the newer state", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const discovered = await createStored(repository);

    // Revision 2 is now stored: the candidate is under review.
    const submitted = await saveTransition(
      repository,
      discovered,
      submitForReview(discovered.candidate, { expectedRevision: 1, now }),
    );
    expect(submitted.candidate.revision).toBe(2);

    // A second caller still holds the revision-1 snapshot and writes over it.
    const staleWrite = await repository.save({
      candidate: candidate({ status: "rejected", revision: 2, rejectedReason: "STALE_CALLER" }),
      expectedRevision: discovered.candidate.revision,
    });

    expect(staleWrite.status).toBe("conflict");
    if (staleWrite.status !== "conflict") return;
    expect(staleWrite.expectedRevision).toBe(1);
    expect(staleWrite.actualRevision).toBe(2);
    // The reply carries the state the caller must rebase onto, so a retry can be
    // built from real data instead of a guess.
    expect(staleWrite.current).toEqual(submitted);

    // Nothing of the stale write landed: status, revision and reason are intact.
    const stored = await repository.findById(discovered.candidate.id);
    expect(stored).toEqual(submitted);
    expect(stored?.candidate.status).toBe("review_submitted");
    expect(stored?.candidate.rejectedReason).toBeNull();
  });

  it("lets exactly one of two writers holding the same snapshot win", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const discovered = await createStored(repository);

    const submitted = submitForReview(discovered.candidate, { expectedRevision: 1, now });
    if (!submitted.ok) throw new Error("fixture transition refused");

    // Two writers, one precondition: both believe revision 1 is current.
    const outcomes = await Promise.all([
      repository.save({ candidate: submitted.candidate, expectedRevision: 1 }),
      repository.save({
        candidate: candidate({ status: "rejected", revision: 2, rejectedReason: "CONCURRENT" }),
        expectedRevision: 1,
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "saved")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "conflict")).toHaveLength(1);

    const winner = outcomes.find((outcome) => outcome.status === "saved");
    if (winner?.status !== "saved") throw new Error("expected one winning write");
    const stored = await repository.findById(discovered.candidate.id);
    expect(stored).toEqual(winner.record);
    expect(stored?.candidate.revision).toBe(2);
    // The loser's payload is nowhere in stored state.
    expect(stored?.candidate.rejectedReason).toBe(winner.record.candidate.rejectedReason);
  });

  it("prefers the state conflict over a caller-side revision mistake", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const discovered = await createStored(repository);
    await saveTransition(repository, discovered, submitForReview(discovered.candidate, { expectedRevision: 1, now }));

    // expectedRevision says "the row is at 1", the payload says "I am revision 4":
    // both wrong, but the useful answer is that newer state exists.
    const outcome = await repository.save({
      candidate: candidate({ status: "rejected", revision: 4 }),
      expectedRevision: 1,
    });
    expect(outcome.status).toBe("conflict");
    if (outcome.status !== "conflict") return;
    expect(outcome.actualRevision).toBe(2);
  });

  it("refuses a write that does not advance exactly one revision", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const discovered = await createStored(repository);

    // Correct precondition, but the snapshot jumps two revisions: the stored
    // revision would stop being a truthful CAS precondition.
    const jump = await repository.save({
      candidate: candidate({ status: "rejected", revision: 3 }),
      expectedRevision: 1,
    });
    expect(rejectionCode(jump)).toBe("CANDIDATE_REVISION_INVALID");
    expect((await repository.findById(discovered.candidate.id))?.candidate.revision).toBe(1);

    // A repeat of the same revision is not a write either.
    const repeat = await repository.save({ candidate: discovered.candidate, expectedRevision: 1 });
    expect(rejectionCode(repeat)).toBe("CANDIDATE_REVISION_INVALID");
  });

  it("refuses a candidate whose id does not match its own identity", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const mismatched = candidate({ id: "lexeme|article.a|1|0|otro-termino" });

    const created = await repository.create({ candidate: mismatched, provenance: FAKE_PROVENANCE });
    expect(rejectionCode(created)).toBe("CANDIDATE_IDENTITY_MISMATCH");

    const saved = await repository.save({ candidate: mismatched, expectedRevision: 1 });
    expect(rejectionCode(saved)).toBe("CANDIDATE_IDENTITY_MISMATCH");
    expect(await repository.findById(mismatched.id)).toBeNull();
  });

  it("refuses provenance and approval states the columns cannot hold", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const stored = await createStored(repository);

    // `confidence` is an integer percent: 101 and 1.5 are both unstorable.
    for (const confidence of [101, -1, 1.5]) {
      const outcome = await repository.create({
        candidate: candidate({ normalizedText: `c${confidence}`, surfaceText: `c${confidence}`, lemma: `c${confidence}` }),
        provenance: { ...FAKE_PROVENANCE, confidence },
      });
      expect(rejectionCode(outcome)).toBe("CANDIDATE_PROVENANCE_INVALID");
    }

    // `lexicon_candidates_approved_audit_check`: approved needs who and when.
    const unapproved = await repository.save({
      candidate: candidate({ status: "approved", revision: 2 }),
      expectedRevision: stored.candidate.revision,
    });
    expect(rejectionCode(unapproved)).toBe("CANDIDATE_APPROVAL_AUDIT_MISSING");
    expect((await repository.findById(stored.candidate.id))?.candidate.status).toBe("discovered");
  });

  it("reports not_found instead of creating a row on save", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const outcome = await repository.save({ candidate: candidate(), expectedRevision: 1 });
    expect(outcome).toEqual({ status: "not_found", candidateId: candidate().id });
    expect(await repository.findById(candidate().id)).toBeNull();
  });

  it("keeps stored state immune to caller-side mutation", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const mutable = { ...candidate(), source: { ...source() } };
    const created = await repository.create({ candidate: mutable, provenance: FAKE_PROVENANCE });
    expect(created.status).toBe("created");

    // The caller keeps a reference and edits it after the write.
    mutable.status = "approved";
    mutable.revision = 9;
    mutable.source.documentVersion = 7;

    const stored = await repository.findById(mutable.id);
    expect(stored?.candidate.status).toBe("discovered");
    expect(stored?.candidate.revision).toBe(1);
    expect(stored?.candidate.source.documentVersion).toBe(1);

    // And a record handed out cannot be edited into stored state either.
    const handedOut = await repository.findById(mutable.id);
    if (!handedOut) throw new Error("expected a stored record");
    (handedOut as { candidate: { status: string } }).candidate.status = "approved";
    expect((await repository.findById(mutable.id))?.candidate.status).toBe("discovered");
  });

  it("mirrors the identity unique index: same span is a duplicate, other kinds are rows", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const first = await createStored(repository);

    // Re-extraction of the same span: no second row, and the stored state is
    // returned untouched (an approved candidate is never reset to discovered).
    await saveTransition(repository, first, submitForReview(first.candidate, { expectedRevision: 1, now }));
    const duplicate = await repository.create({ candidate: candidate(), provenance: FAKE_PROVENANCE });
    expect(duplicate.status).toBe("exists");
    if (duplicate.status !== "exists") return;
    expect(duplicate.record.candidate.status).toBe("review_submitted");

    // Same stable key and version, media instead of article: the unique index
    // treats it as a different identity, so it is a separate row with its own id.
    const media = await createStored(repository, { source: source({ documentKind: "media" }) });
    expect(media.candidate.id).not.toBe(first.candidate.id);
    expect((await repository.listBySource({ ...SOURCE, documentKind: "media" }))).toHaveLength(1);
    expect(await repository.listBySource(SOURCE)).toHaveLength(1);

    // Because `makeCandidateId()` now encodes documentKind, the id and the unique
    // index agree column for column and each id names exactly one row, so an
    // id-only lookup resolves rather than being refused as ambiguous.
    const viaId = await repository.findById(first.candidate.id);
    expect(viaId).not.toBeNull();
    expect(viaId?.candidate.id).toBe(first.candidate.id);
    expect(viaId?.candidate.source.documentKind).toBe("article");

    const mediaViaId = await repository.findById(media.candidate.id);
    expect(mediaViaId).not.toBeNull();
    expect(mediaViaId?.candidate.id).toBe(media.candidate.id);
    expect(mediaViaId?.candidate.source.documentKind).toBe("media");
  });
});

describe("candidate persistence: the indexable query is gate-adjacent", () => {
  it("never returns a candidate that is not approved", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const discovered = await storedAtStatus(repository, "discovered");
    const submitted = await storedAtStatus(repository, "review_submitted", {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo",
    });
    const ready = await storedAtStatus(repository, "review_ready", {
      surfaceText: "réplica", normalizedText: "replica", lemma: "replica",
    });
    const rejected = await storedAtStatus(repository, "rejected", {
      surfaceText: "réplicas", normalizedText: "replicas", lemma: "replicas",
    });
    const approved = await storedAtStatus(repository, "approved", {
      surfaceText: "epicentro", normalizedText: "epicentro", lemma: "epicentro",
    });

    const indexable = await repository.listIndexable(SOURCE);
    expect(indexable.map((record) => record.candidate.id)).toEqual([approved.candidate.id]);
    expect(indexable.every((record) => isIndexable(record.candidate))).toBe(true);

    // The whole population is still visible by source, so an operator can see
    // what is waiting; only the corpus gate query is filtered.
    expect((await repository.listBySource(SOURCE)).map((record) => record.candidate.id).sort())
      .toEqual([discovered, submitted, ready, rejected, approved].map((record) => record.candidate.id).sort());
  });

  it("scopes both source queries to one document version", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const versionOne = await storedAtStatus(repository, "approved");
    const versionTwo = await storedAtStatus(repository, "approved", {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo",
      source: source({ documentVersion: 2 }),
    });

    expect((await repository.listIndexable(SOURCE)).map((record) => record.candidate.id))
      .toEqual([versionOne.candidate.id]);
    expect((await repository.listIndexable({ ...SOURCE, documentVersion: 2 })).map((record) => record.candidate.id))
      .toEqual([versionTwo.candidate.id]);
  });

  it("orders by source: segment index, then kind, then normalized text", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const lateSegment = await createStored(repository, {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", source: source({ segmentIndex: 2 }),
    });
    const earlyPhrase = await createStored(repository, {
      kind: "phrase", surfaceText: "Y en Panamá", normalizedText: "y en panama", lemma: null, meaningZh: "在巴拿马",
    });
    const earlyLexeme = await createStored(repository);

    expect((await repository.listBySource(SOURCE)).map((record) => record.candidate.id)).toEqual([
      earlyLexeme.candidate.id,
      earlyPhrase.candidate.id,
      lateSegment.candidate.id,
    ]);
  });
});

describe("candidate persistence: approval audits", () => {
  const batchAudit = (
    record: LexiconCandidateRecord,
    batchId: string,
  ): LexiconCandidateApprovalRecord => ({
    candidateId: record.candidate.id,
    mode: "batch",
    batchId,
    approvedBy: OWNER,
    approvedAt: later,
    revision: record.candidate.revision,
    documentKind: record.candidate.source.documentKind,
    documentStableKey: record.candidate.source.documentStableKey,
    documentVersion: record.candidate.source.documentVersion,
    segmentIndex: record.candidate.source.segmentIndex,
    reviews: record.candidate.reviews,
    lexemes: 1,
    phrases: 0,
  });

  it("stores one record per candidate and one shared batchId", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const first = await storedAtStatus(repository, "approved");
    const second = await storedAtStatus(repository, "approved", {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo",
    });

    const outcome = await repository.insertApprovalAudits([
      batchAudit(first, "batch-1"),
      batchAudit(second, "batch-1"),
    ]);
    expect(outcome).toEqual({ status: "recorded", inserted: 2, duplicates: 0 });

    const audits = await repository.listApprovalAudits({ batchId: "batch-1" });
    // One record per candidate: the batch shares a grouping id, never a row.
    expect(audits).toHaveLength(2);
    // Documented order: `approvedAt`, then candidate id (both were approved at
    // the same instant, so the id decides).
    expect(audits.map((audit) => audit.candidateId)).toEqual(
      [first.candidate.id, second.candidate.id].sort((left, right) => left.localeCompare(right, "es")),
    );
    for (const audit of audits) {
      expect(audit.mode).toBe("batch");
      expect(audit.batchId).toBe("batch-1");
      expect(audit.approvedBy).toBe(OWNER);
      expect(audit.approvedAt).toEqual(later);
      expect(audit.revision).toBe(first.candidate.revision);
      // Dual review is provable from the audit record alone.
      expect(audit.reviews.map((entry) => `${entry.dimension}:${entry.outcome}`)).toEqual([
        "content-es-ES:pass",
        "teaching-zh-CN:pass",
      ]);
    }
  });

  it("is idempotent: a repeated approval does not add a second audit record", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const approved = await storedAtStatus(repository, "approved");
    const audit = batchAudit(approved, "batch-1");

    expect(await repository.insertApprovalAudit(audit)).toEqual({ status: "recorded", inserted: 1, duplicates: 0 });
    expect(await repository.insertApprovalAudit(audit)).toEqual({ status: "recorded", inserted: 0, duplicates: 1 });
    expect(await repository.listApprovalAudits({ candidateId: approved.candidate.id })).toHaveLength(1);
  });

  it("rejects a malformed batch before writing any record", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const first = await storedAtStatus(repository, "approved");
    const second = await storedAtStatus(repository, "approved", {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo",
    });

    const duplicateInCall = await repository.insertApprovalAudits([
      batchAudit(first, "batch-1"),
      batchAudit(first, "batch-1"),
    ]);
    expect(duplicateInCall.status).toBe("rejected");
    if (duplicateInCall.status === "rejected") {
      expect(duplicateInCall.code).toBe("CANDIDATE_AUDIT_DUPLICATE_IN_CALL");
    }

    const mixedBatchIds = await repository.insertApprovalAudits([
      batchAudit(first, "batch-1"),
      batchAudit(second, "batch-2"),
    ]);
    expect(mixedBatchIds.status).toBe("rejected");
    if (mixedBatchIds.status === "rejected") {
      expect(mixedBatchIds.code).toBe("CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT");
    }

    const mixedModes = await repository.insertApprovalAudits([
      batchAudit(first, "batch-1"),
      { ...batchAudit(second, "batch-1"), mode: "single", batchId: null },
    ]);
    expect(mixedModes.status).toBe("rejected");
    if (mixedModes.status === "rejected") {
      expect(mixedModes.code).toBe("CANDIDATE_AUDIT_BATCH_ID_INCONSISTENT");
    }

    const inconsistentMode = await repository.insertApprovalAudit({
      ...batchAudit(first, "batch-1"),
      mode: "single",
    });
    expect(inconsistentMode.status).toBe("rejected");
    if (inconsistentMode.status === "rejected") {
      expect(inconsistentMode.code).toBe("CANDIDATE_AUDIT_MODE_INCONSISTENT");
    }

    // All-or-nothing: none of the malformed calls left anything behind.
    expect(await repository.listApprovalAudits({})).toHaveLength(0);
  });

  it("treats an empty batch as a no-op", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    expect(await repository.insertApprovalAudits([])).toEqual({ status: "recorded", inserted: 0, duplicates: 0 });
  });
});

describe("candidate persistence: approval stays idempotent through the gate", () => {
  it("indexes exactly once when the same approval is applied twice", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const { repository: corpusRepository, calls } = createRecordingRepository();
    const ready = await storedAtStatus(repository, "review_ready");

    // First approval: the stored revision is the CAS precondition.
    const first = await approveCandidateAndIndex(corpusRepository, {
      candidate: ready.candidate,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.candidate.revision,
      now: later,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.indexed).toBe(true);
    expect(calls).toHaveLength(1);

    const storedApproved = mustSave(await repository.save({
      candidate: first.candidate,
      expectedRevision: ready.candidate.revision,
    }));
    expect(storedApproved.candidate.status).toBe("approved");

    // Second attempt with the stored (approved) snapshot: idempotent, and the
    // corpus is not written a second time.
    const repeat = await approveCandidateAndIndex(corpusRepository, {
      candidate: storedApproved.candidate,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: storedApproved.candidate.revision,
      now: later,
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.duplicate).toBe(true);
    expect(repeat.indexed).toBe(false);
    expect(repeat.audit).toBeNull();
    expect(calls).toHaveLength(1);

    // And the same repeat must not move stored state: the CAS precondition from
    // before the approval is stale now.
    const staleRepeat = await repository.save({
      candidate: first.candidate,
      expectedRevision: ready.candidate.revision,
    });
    expect(staleRepeat.status).toBe("conflict");
    if (staleRepeat.status !== "conflict") return;
    expect(staleRepeat.actualRevision).toBe(storedApproved.candidate.revision);
    expect(staleRepeat.current).toEqual(storedApproved);
  });

  it("has nothing to index while the gate is still waiting for approval", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const { repository: corpusRepository, calls } = createRecordingRepository();
    const ready = await storedAtStatus(repository, "review_ready");

    // The persistence half of the gate: an unapproved candidate is not even
    // offered to `indexApprovedCandidate()`.
    expect(await repository.listIndexable(SOURCE)).toEqual([]);
    const outcome = await indexApprovedCandidate(corpusRepository, {
      candidate: ready.candidate,
      frozen: FROZEN,
    });
    expect(outcome).toEqual({ ok: false, code: "CANDIDATE_NOT_APPROVED" });
    expect(calls).toHaveLength(0);
  });

  it("accepts the application layer's batch audits and keeps one per candidate", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const { repository: corpusRepository, calls } = createRecordingRepository();

    // Low-risk class only (no part-of-speech claim), as ADR-0011 §5 requires.
    const first = await storedAtStatus(repository, "review_ready", { partOfSpeech: null });
    const second = await storedAtStatus(repository, "review_ready", {
      surfaceText: "sismo", normalizedText: "sismo", lemma: "sismo", partOfSpeech: null,
    });

    const outcome = await approveCandidateBatch(corpusRepository, {
      ...SOURCE,
      requests: [
        { candidate: first.candidate, frozen: FROZEN },
        { candidate: second.candidate, frozen: FROZEN },
      ],
      approvedBy: OWNER,
      now: later,
      batchId: "batch-9",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(calls).toHaveLength(2);

    // The application's audit record is accepted by the repository unchanged:
    // the two shapes cannot drift without failing `tsc`.
    const written = await repository.insertApprovalAudits(outcome.audits);
    expect(written).toEqual({ status: "recorded", inserted: 2, duplicates: 0 });

    const audits = await repository.listApprovalAudits({ batchId: "batch-9" });
    expect(audits).toHaveLength(outcome.audits.length);
    expect(audits).toHaveLength(2);
    // Same records the application produced, ordered by candidate id.
    const byCandidateId = (left: { candidateId: string }, right: { candidateId: string }) =>
      left.candidateId.localeCompare(right.candidateId, "es");
    expect([...audits].sort(byCandidateId)).toEqual([...outcome.audits].sort(byCandidateId));
    expect(audits.every((audit) => audit.mode === "batch" && audit.batchId === "batch-9")).toBe(true);

    // The approved state is what the store now offers to a later indexing run.
    for (const approved of outcome.approved) {
      const stored = mustSave(await repository.save({
        candidate: approved,
        expectedRevision: approved.revision - 1,
      }));
      expect(stored.candidate.status).toBe("approved");
    }
    expect((await repository.listIndexable(SOURCE)).map((record) => record.candidate.status)).toEqual([
      "approved",
      "approved",
    ]);
  });

  it("persists a candidate assembled from the fake provider and indexes it once", async () => {
    const repository = createInMemoryLexiconCandidateRepository();
    const { repository: corpusRepository, calls } = createRecordingRepository();

    const provider = createFakeLexemeCandidateProvider();
    const segment = fakeSegment();
    const extraction = await provider.extractCandidates({
      language: "es",
      segments: [segment],
      maxCandidatesPerSegment: 50,
    });
    expect(extraction.provider).toBe("fake");
    const proposal = extraction.proposals.find(
      (item) => item.kind === "lexeme" && item.normalizedText === "terremoto",
    );
    expect(proposal).toBeDefined();
    if (!proposal) return;

    const created = await repository.create({
      candidate: candidateFromProposal(proposal, segment),
      provenance: {
        provider: extraction.provider,
        modelVersion: extraction.modelVersion,
        confidence: Math.round(proposal.confidence * 100),
      },
    });
    expect(created.status).toBe("created");
    if (created.status !== "created") return;
    expect(created.record.provenance).toEqual({
      provider: "fake",
      modelVersion: "fake-lexicon-extraction-v1",
      confidence: 100,
    });

    // Drive the stored candidate to review_ready through the real transitions.
    let stored = created.record;
    stored = await saveTransition(
      repository,
      stored,
      submitForReview(stored.candidate, { expectedRevision: stored.candidate.revision, now }),
    );
    for (const dimension of DIMENSIONS) {
      stored = await saveTransition(
        repository,
        stored,
        recordReview(stored.candidate, {
          review: review(dimension, "pass"),
          expectedRevision: stored.candidate.revision,
          now,
        }),
      );
    }
    expect(stored.candidate.status).toBe("review_ready");

    const frozen: LexiconCandidateFrozenSource = {
      documentKind: "article",
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      sourceText: segment.sourceText,
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
      paragraphId: "p1",
    };
    const outcome = await approveCandidateAndIndex(corpusRepository, {
      candidate: stored.candidate,
      frozen,
      approvedBy: OWNER,
      expectedRevision: stored.candidate.revision,
      now: later,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.indexed).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call?.kind !== "lexeme") throw new Error("expected a lexeme write");
    expect(call.input.lemma).toBe("terremoto");
    expect(call.input.lemmaStatus).toBe("verified");

    mustSave(await repository.save({ candidate: outcome.candidate, expectedRevision: stored.candidate.revision }));
    expect(await repository.listIndexable(SOURCE)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

/** Assemble a `LexiconCandidate` from a provider proposal, as the pipeline will. */
function candidateFromProposal(
  proposal: LexiconCandidateProposal,
  segment: LexiconExtractionSegment,
): LexiconCandidate {
  return candidate({
    kind: proposal.kind,
    surfaceText: proposal.surfaceText,
    normalizedText: proposal.normalizedText,
    lemma: proposal.lemma,
    partOfSpeech: proposal.partOfSpeech,
    meaningZh: proposal.meaningZh,
    source: source({
      documentKind: segment.documentKind,
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      contextBefore: "",
      contextAfter: "",
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
    }),
  });
}
