import { describe, expect, it } from "vitest";

import * as application from "@/src/modules/lexicon-corpus/application";
import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "@/src/modules/content-acquisition/domain/review-identity";
import {
  approveCandidateAndIndex,
  approveCandidateBatch,
  buildCandidateIndexEntry,
  buildCandidateReference,
  candidateMatchesFrozenSource,
  indexApprovedCandidate,
  isLowRiskBatchApprovableCandidate,
  type LexiconCandidateFrozenSource,
} from "@/src/modules/lexicon-corpus/application/approve-candidate-indexing";
import {
  approveCandidateForIndexing,
  recordCandidateReview,
  submitCandidateForReview,
  type LexiconCandidateReviewResult,
} from "@/src/modules/lexicon-corpus/application/lexicon-candidate-review";
import {
  makeCandidateId,
  type LexiconCandidate,
  type LexiconCandidateSource,
  type LexiconCandidateStatus,
} from "@/src/modules/lexicon-corpus/domain/lexicon-candidate";
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
 * Slice 5: owner approval gates the corpus write.
 *
 * The repository below is a fake that *records* every index call, so these tests
 * can assert the one thing that matters most: the corpus is written 0 times until
 * a candidate is approved, exactly 1 time afterwards, and never twice.
 */

const now = new Date("2026-10-10T12:00:00.000Z");
const later = new Date("2026-10-10T13:00:00.000Z");
const OWNER = OWNER_AUTHORIZED_REVIEWER_REFERENCE;
const dimensions = ["content-es-ES", "teaching-zh-CN"] as const;

const FROZEN: LexiconCandidateFrozenSource = {
  documentKind: "article",
  documentStableKey: "article.a",
  documentVersion: 1,
  segmentIndex: 0,
  sourceText: "Y en Panamá un terremoto de magnitud 7.2 acudió el sureste del país.",
  sourceTitle: "Alerta de tsunami",
  sourceKind: "article-rss",
  paragraphId: "p1",
};

type IndexCall =
  | Readonly<{ kind: "lexeme"; input: LexemeIndexInput; sourceTitle: string; sourceKind: string }>
  | Readonly<{ kind: "phrase"; input: PhraseIndexInput; sourceTitle: string; sourceKind: string }>;

/**
 * Records every corpus write. Every other method throws or returns empty: a test
 * that accidentally depends on them should fail loudly rather than silently pass.
 */
function createRecordingRepository(): { repository: LexiconCorpusRepository; calls: IndexCall[] } {
  const calls: IndexCall[] = [];
  const repository: LexiconCorpusRepository = {
    listFrequencyWords: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    readFrequencyWord: async () => null,
    findCorpusExample: async () => null,
    listVocabulary: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    listPhrases: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    setIntent: async () => {
      throw new Error("setIntent must not be called by the indexing gate");
    },
    indexLexeme: async (input, sourceTitle, sourceKind) => {
      calls.push({ kind: "lexeme", input, sourceTitle, sourceKind });
      return `lexeme-${calls.length}`;
    },
    indexPhrase: async (input, sourceTitle, sourceKind) => {
      calls.push({ kind: "phrase", input, sourceTitle, sourceKind });
      return `phrase-${calls.length}`;
    },
    searchCorpus: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
    listCorpusClusters: async () => ({ items: [], page: 1, pageSize: 8, total: 0 }),
    getAssessment: async () => null,
    submitAssessment: async () => {
      throw new Error("submitAssessment must not be called by the indexing gate");
    },
  };
  return { repository, calls };
}

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

function candidate(overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  return {
    id: "lexeme|article|article.a|1|0|terremoto",
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
    ...overrides,
  };
}

function unwrap(result: LexiconCandidateReviewResult): LexiconCandidate {
  if (!result.ok) throw new Error(`unexpected failure: ${result.code}`);
  return result.candidate;
}

/** A lexeme candidate with no part-of-speech claim: the batch-approval class. */
function lowRiskCandidate(normalizedText: string, overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  return candidate({
    id: `lexeme|article|article.a|1|0|${normalizedText}`,
    surfaceText: normalizedText,
    normalizedText,
    lemma: normalizedText,
    partOfSpeech: null,
    ...overrides,
  });
}

function readyFrom(start: LexiconCandidate): LexiconCandidate {
  let current = unwrap(submitCandidateForReview(start, { expectedRevision: start.revision, now }));
  for (const dimension of dimensions) {
    current = unwrap(
      recordCandidateReview(current, {
        dimension,
        outcome: "pass",
        reviewerReference: OWNER,
        reviewedAt: now,
        expectedRevision: current.revision,
        now,
      }),
    );
  }
  return current;
}

/** A candidate driven to the requested status through the application entry points. */
function atStatus(status: LexiconCandidateStatus, overrides: Partial<LexiconCandidate> = {}): LexiconCandidate {
  const start = candidate(overrides);
  if (status === "discovered") return start;
  const submitted = unwrap(submitCandidateForReview(start, { expectedRevision: start.revision, now }));
  if (status === "review_submitted") return submitted;
  if (status === "rejected") {
    return unwrap(
      recordCandidateReview(submitted, {
        dimension: "content-es-ES",
        outcome: "fail",
        reviewerReference: OWNER,
        reviewedAt: now,
        expectedRevision: submitted.revision,
        now,
      }),
    );
  }
  const ready = readyFrom(candidate(overrides));
  if (status === "review_ready") return ready;
  return unwrap(approveCandidateForIndexing(ready, { approvedBy: OWNER, expectedRevision: ready.revision, now: later }));
}

describe("owner approval gates the corpus write (LEX-INDEX-001 slice 5)", () => {
  it("is reachable from the module's application entry point", () => {
    // Guards the barrel wiring: a name that collides under `export *` would be
    // silently dropped from the public surface.
    expect(application.recordCandidateReview).toBe(recordCandidateReview);
    expect(application.approveCandidateForIndexing).toBe(approveCandidateForIndexing);
    expect(application.indexApprovedCandidate).toBe(indexApprovedCandidate);
    expect(application.approveCandidateAndIndex).toBe(approveCandidateAndIndex);
    expect(application.approveCandidateBatch).toBe(approveCandidateBatch);
  });

  it("leaves the corpus untouched for every status except approved", async () => {
    for (const status of ["discovered", "review_submitted", "review_ready", "rejected"] as const) {
      const { repository, calls } = createRecordingRepository();
      const result = await indexApprovedCandidate(repository, { candidate: atStatus(status), frozen: FROZEN });
      expect(result).toEqual({ ok: false, code: "CANDIDATE_NOT_APPROVED" });
      expect(calls).toHaveLength(0);
    }
  });

  it("indexes exactly once after owner approval", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    expect(calls).toHaveLength(0);

    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.candidate.status).toBe("approved");
    expect(outcome.indexed).toBe(true);
    expect(outcome.duplicate).toBe(false);
    expect(outcome.audit?.mode).toBe("single");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("lexeme");
  });

  it("does not index again when the approval is repeated", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const first = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(calls).toHaveLength(1);

    // Same revision, same approved candidate: idempotent success, no second write.
    const repeat = await approveCandidateAndIndex(repository, {
      candidate: first.candidate,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: first.candidate.revision,
      now: later,
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;
    expect(repeat.duplicate).toBe(true);
    expect(repeat.indexed).toBe(false);
    expect(repeat.audit).toBeNull();
    expect(repeat.lexemes).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("refuses a stale expected revision for the snapshot in hand", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const stale = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision - 1,
      now: later,
    });
    expect(stale).toEqual({ ok: false, code: "CANDIDATE_REVISION_CONFLICT" });
    expect(calls).toHaveLength(0);
  });

  it("re-indexes a stale pre-approval snapshot because candidates are not persisted yet", async () => {
    // LIMITATION, locked in on purpose: with no candidate row there is no
    // server-side revision to compare against, so retrying with the pre-approval
    // snapshot is indistinguishable from a first approval. The corpus itself
    // stays idempotent — `indexLexeme`/`indexPhrase` use `onConflictDoNothing`,
    // so the repeated write is the *same* write — but the repository call is
    // repeated. Candidate persistence (CAS on the stored revision) is the slice
    // that closes this; passing the approved snapshot is the supported retry
    // today (see the previous test).
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const first = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(1);

    const stale = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.duplicate).toBe(false);
    expect(calls).toHaveLength(2);
    // Identical write: the unique key in the writer is what keeps the corpus at
    // one occurrence, not this layer.
    expect(calls[1]).toEqual(calls[0]);
  });

  it("never re-indexes a candidate that is already approved", async () => {
    const { repository, calls } = createRecordingRepository();
    const approved = atStatus("approved");
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: approved,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: approved.revision,
      now: later,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.duplicate).toBe(true);
    expect(outcome.indexed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("cannot approve a candidate whose dual review is incomplete", async () => {
    const { repository, calls } = createRecordingRepository();
    const submitted = atStatus("review_submitted");
    const half = unwrap(
      recordCandidateReview(submitted, {
        dimension: "content-es-ES",
        outcome: "pass",
        reviewerReference: OWNER,
        reviewedAt: now,
        expectedRevision: submitted.revision,
        now,
      }),
    );

    const outcome = await approveCandidateAndIndex(repository, {
      candidate: half,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: half.revision,
      now: later,
    });
    expect(outcome).toEqual({ ok: false, code: "CANDIDATE_INVALID_TRANSITION" });
    expect(calls).toHaveLength(0);

    // Even a candidate whose status claims review_ready must carry both review
    // rows; the approval gate does not trust the status alone.
    const forged = candidate({
      status: "review_ready",
      revision: 4,
      partOfSpeech: null,
      reviews: [{ dimension: "content-es-ES", outcome: "pass", reviewerReference: OWNER, reviewedAt: now }],
    });
    const forgedOutcome = await approveCandidateAndIndex(repository, {
      candidate: forged,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: forged.revision,
      now: later,
    });
    expect(forgedOutcome).toEqual({ ok: false, code: "CANDIDATE_REVIEW_INCOMPLETE" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an approver that is not owner-authorized", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: "owner",
      expectedRevision: ready.revision,
      now: later,
    });
    expect(outcome).toEqual({ ok: false, code: "CANDIDATE_REVIEWER_NOT_AUTHORIZED" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to approve a candidate that was never submitted or was rejected", async () => {
    const { repository, calls } = createRecordingRepository();
    for (const status of ["discovered", "review_submitted"] as const) {
      const current = atStatus(status);
      const outcome = await approveCandidateAndIndex(repository, {
        candidate: current,
        frozen: FROZEN,
        approvedBy: OWNER,
        expectedRevision: current.revision,
        now: later,
      });
      expect(outcome).toEqual({ ok: false, code: "CANDIDATE_INVALID_TRANSITION" });
    }

    const rejected = atStatus("rejected");
    const rejectedOutcome = await approveCandidateAndIndex(repository, {
      candidate: rejected,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: rejected.revision,
      now: later,
    });
    expect(rejectedOutcome).toEqual({ ok: false, code: "CANDIDATE_REJECTED_IS_TERMINAL" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to index when the frozen segment is not the candidate's source", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const wrongVersion: LexiconCandidateFrozenSource = { ...FROZEN, documentVersion: 2 };
    const wrongSegment: LexiconCandidateFrozenSource = { ...FROZEN, segmentIndex: 3 };
    const wrongTitle: LexiconCandidateFrozenSource = { ...FROZEN, sourceTitle: "Otro artículo" };

    for (const frozen of [wrongVersion, wrongSegment, wrongTitle]) {
      expect(candidateMatchesFrozenSource(ready, frozen)).toBe(false);
      expect(buildCandidateReference(ready, frozen)).toBeNull();
      const outcome = await approveCandidateAndIndex(repository, {
        candidate: ready,
        frozen,
        approvedBy: OWNER,
        expectedRevision: ready.revision,
        now: later,
      });
      expect(outcome).toEqual({ ok: false, code: "CANDIDATE_SOURCE_MISMATCH" });
    }

    // The low-level gate refuses too, even for an approved candidate.
    const approved = atStatus("approved");
    expect(
      await indexApprovedCandidate(repository, { candidate: approved, frozen: wrongVersion }),
    ).toEqual({ ok: false, code: "CANDIDATE_SOURCE_MISMATCH" });
    expect(calls).toHaveLength(0);
  });

  it("refuses to index an approved lexeme that carries no lemma", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready", {
      lemma: null,
      id: "lexeme|article|article.a|1|0|sismo",
      surfaceText: "sismo",
      normalizedText: "sismo",
      partOfSpeech: null,
    });
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(outcome).toEqual({ ok: false, code: "CANDIDATE_INDEX_INPUT_INCOMPLETE" });
    expect(calls).toHaveLength(0);
  });

  it("writes the approved lexeme with honest provenance", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready");
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(outcome.ok).toBe(true);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.kind).toBe("lexeme");
    if (call.kind !== "lexeme") return;
    expect(call.input).toEqual({
      lemma: "terremoto",
      normalizedLemma: "terremoto",
      // `verified` is honest here: this candidate passed both reviews and was approved.
      lemmaStatus: "verified",
      partOfSpeech: "NOUN",
      meaningZh: null,
      form: "terremoto",
      normalizedForm: "terremoto",
      reference: {
        document: { kind: "article", stableKey: "article.a", version: 1 },
        position: { kind: "text", paragraphId: "p1", segmentIndex: 0 },
        sourceText: FROZEN.sourceText,
        contextBefore: "Y en Panamá, un ",
        contextAfter: " de magnitud 7.2",
      },
    });
    expect(call.sourceTitle).toBe("Alerta de tsunami");
    expect(call.sourceKind).toBe("article-rss");
  });

  it("keeps lemmaStatus pending until approval", () => {
    const discovered = buildCandidateIndexEntry(atStatus("discovered"));
    expect(discovered?.kind).toBe("lexeme");
    if (discovered?.kind !== "lexeme") return;
    expect(discovered.lexeme.lemmaStatus).toBe("pending");

    const approved = buildCandidateIndexEntry(atStatus("approved"));
    if (approved?.kind !== "lexeme") throw new Error("expected a lexeme entry");
    expect(approved.lexeme.lemmaStatus).toBe("verified");
  });

  it("writes an approved phrase as a phrase entry and never as a lexeme", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = atStatus("review_ready", {
      id: "phrase|article|article.a|1|0|y en panama un terremoto",
      kind: "phrase",
      surfaceText: "Y en Panamá un terremoto",
      normalizedText: "y en panama un terremoto",
      lemma: null,
      partOfSpeech: null,
      meaningZh: "在巴拿马发生了一场地震",
    });
    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen: FROZEN,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.phrases).toBe(1);
    expect(outcome.lexemes).toBe(0);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.kind).toBe("phrase");
    if (call.kind !== "phrase") return;
    expect(call.input.expression).toBe("Y en Panamá un terremoto");
    expect(call.input.normalizedExpression).toBe("y en panama un terremoto");
    expect(call.input.meaningZh).toBe("在巴拿马发生了一场地震");
    expect(call.input.ownerUserId).toBeNull();
  });

  it("builds a media reference for a media candidate", () => {
    const mediaFrozen: LexiconCandidateFrozenSource = {
      documentKind: "media",
      documentStableKey: "media.podcast-1",
      documentVersion: 3,
      segmentIndex: 7,
      sourceText: "El sismo se sintió en la capital.",
      sourceTitle: "Noticias de hoy",
      sourceKind: "podcast-rss",
      startMs: 120000,
      endMs: 126000,
    };
    const mediaCandidate = atStatus("approved", {
      id: "lexeme|media|media.podcast-1|3|7|sismo",
      surfaceText: "sismo",
      normalizedText: "sismo",
      lemma: "sismo",
      partOfSpeech: null,
      source: source({
        documentKind: "media",
        documentStableKey: "media.podcast-1",
        documentVersion: 3,
        segmentIndex: 7,
        sourceTitle: "Noticias de hoy",
        sourceKind: "podcast-rss",
      }),
    });
    expect(buildCandidateReference(mediaCandidate, mediaFrozen)).toEqual({
      document: { kind: "media", stableKey: "media.podcast-1", version: 3 },
      position: { kind: "media", startMs: 120000, endMs: 126000, segmentIndex: 7 },
      sourceText: "El sismo se sintió en la capital.",
      contextBefore: "Y en Panamá, un ",
      contextAfter: " de magnitud 7.2",
    });
  });

  it("indexes a candidate assembled from the fake provider exactly once", async () => {
    const { repository, calls } = createRecordingRepository();
    const provider = createFakeLexemeCandidateProvider();
    const segment = fakeSegment();
    const result = await provider.extractCandidates({
      language: "es",
      segments: [segment],
      maxCandidatesPerSegment: 50,
    });
    const proposal = result.proposals.find(
      (item) => item.kind === "lexeme" && item.normalizedText === "terremoto",
    );
    expect(proposal).toBeDefined();
    if (!proposal) return;

    // `fakeSegment()` is an article segment; the frozen position for an article
    // is a paragraph id, which the extraction segment itself does not carry.
    expect(segment.documentKind).toBe("article");
    const frozen: LexiconCandidateFrozenSource = {
      documentKind: "article",
      documentStableKey: segment.documentStableKey,
      documentVersion: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      sourceText: segment.sourceText,
      sourceTitle: segment.sourceTitle,
      sourceKind: segment.sourceKind,
      // Article-level fact that the extraction segment does not carry.
      paragraphId: "p1",
    };
    const assembled = candidateFromProposal(proposal, segment);

    const ready = readyFrom(assembled);
    expect(ready.status).toBe("review_ready");
    expect(calls).toHaveLength(0);

    const outcome = await approveCandidateAndIndex(repository, {
      candidate: ready,
      frozen,
      approvedBy: OWNER,
      expectedRevision: ready.revision,
      now: later,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.indexed).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call.kind !== "lexeme") throw new Error("expected a lexeme write");
    expect(call.input.lemma).toBe("terremoto");
    expect(call.input.lemmaStatus).toBe("verified");
  });
});

/** Assemble a `LexiconCandidate` from a provider proposal, as the pipeline will. */
function candidateFromProposal(
  proposal: LexiconCandidateProposal,
  segment: LexiconExtractionSegment,
): LexiconCandidate {
  return {
    id: makeCandidateId({
      kind: proposal.kind,
      documentKind: segment.documentKind,
      stableKey: segment.documentStableKey,
      version: segment.documentVersion,
      segmentIndex: segment.segmentIndex,
      normalizedText: proposal.normalizedText,
    }),
    kind: proposal.kind,
    surfaceText: proposal.surfaceText,
    normalizedText: proposal.normalizedText,
    lemma: proposal.lemma,
    partOfSpeech: proposal.partOfSpeech,
    meaningZh: proposal.meaningZh,
    status: "discovered",
    revision: 1,
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
    reviews: [],
    approvedBy: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("bulk approval stays inside ADR-0011 §5 (LEX-INDEX-001 slice 5)", () => {
  const batch = {
    documentKind: "article" as const,
    documentStableKey: "article.a",
    documentVersion: 1,
    approvedBy: OWNER,
    now: later,
    batchId: "batch-1",
  };

  it("approves low-risk lexemes of one source and leaves one audit record each", async () => {
    const { repository, calls } = createRecordingRepository();
    const first = readyFrom(lowRiskCandidate("terremoto"));
    const second = readyFrom(lowRiskCandidate("sismo"));
    expect(isLowRiskBatchApprovableCandidate(first)).toBe(true);

    const outcome = await approveCandidateBatch(repository, {
      ...batch,
      requests: [
        { candidate: first, frozen: FROZEN },
        { candidate: second, frozen: FROZEN },
      ],
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.approved.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(outcome.approved.every((item) => item.status === "approved")).toBe(true);
    expect(outcome.lexemes).toBe(2);
    expect(calls).toHaveLength(2);

    // One audit record per candidate, all tied to the same batch run.
    expect(outcome.audits.map((audit) => audit.candidateId)).toEqual([first.id, second.id]);
    for (const audit of outcome.audits) {
      expect(audit.mode).toBe("batch");
      expect(audit.batchId).toBe("batch-1");
      expect(audit.approvedBy).toBe(OWNER);
      expect(audit.approvedAt).toEqual(later);
      expect(audit.revision).toBe(5);
      expect(audit.documentStableKey).toBe("article.a");
      expect(audit.documentVersion).toBe(1);
      expect(audit.segmentIndex).toBe(0);
      expect(audit.lexemes).toBe(1);
      expect(audit.phrases).toBe(0);
      // Dual review is provable from the audit itself.
      expect(audit.reviews.map((review) => `${review.dimension}:${review.outcome}:${review.reviewerReference}`)).toEqual([
        `content-es-ES:pass:${OWNER}`,
        `teaching-zh-CN:pass:${OWNER}`,
      ]);
    }
  });

  it("refuses a batch containing a part-of-speech claim or a phrase", async () => {
    const { repository, calls } = createRecordingRepository();
    // Default fixture claims partOfSpeech NOUN: not the low-risk class.
    const claimed = readyFrom(lowRiskCandidate("terremoto", { partOfSpeech: "NOUN" }));
    expect(isLowRiskBatchApprovableCandidate(claimed)).toBe(false);

    const phrase = readyFrom(
      candidate({
        id: "phrase|article|article.a|1|0|y en panama",
        kind: "phrase",
        surfaceText: "Y en Panamá",
        normalizedText: "y en panama",
        lemma: null,
        partOfSpeech: null,
        meaningZh: "在巴拿马",
      }),
    );

    const safe = readyFrom(lowRiskCandidate("sismo"));
    for (const offender of [claimed, phrase]) {
      const outcome = await approveCandidateBatch(repository, {
        ...batch,
        requests: [
          { candidate: safe, frozen: FROZEN },
          { candidate: offender, frozen: FROZEN },
        ],
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) continue;
      expect(outcome.code).toBe("CANDIDATE_BATCH_NOT_ALLOWED");
      expect(outcome.violations).toEqual([{ candidateId: offender.id, code: "CANDIDATE_BATCH_NOT_ALLOWED" }]);
    }
    // All-or-nothing: the eligible member of the batch was not indexed either.
    expect(calls).toHaveLength(0);
  });

  it("does not let bulk approval confirm a gloss, now that lexemes carry one", async () => {
    const { repository, calls } = createRecordingRepository();
    // The low-risk class used to be "a lexeme with no part-of-speech claim",
    // because glosses were a phrase-only concern and a lexeme could never have
    // one. Extraction now requires a gloss on every proposal, so without the
    // `meaningZh` clause this candidate would have become bulk-approvable and
    // "no translation is ever approved in bulk" would have quietly stopped
    // being true.
    const glossed = lowRiskCandidate("terremoto", { meaningZh: "地震" });
    expect(isLowRiskBatchApprovableCandidate(glossed)).toBe(false);

    const safe = readyFrom(lowRiskCandidate("sismo"));
    expect(isLowRiskBatchApprovableCandidate(safe)).toBe(true);

    const outcome = await approveCandidateBatch(repository, {
      ...batch,
      requests: [
        { candidate: safe, frozen: FROZEN },
        { candidate: readyFrom(glossed), frozen: FROZEN },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("CANDIDATE_BATCH_NOT_ALLOWED");
    // All-or-nothing: the glossed member is refused as a member, so the
    // eligible one is not indexed either.
    expect(calls).toHaveLength(0);
  });

  it("does not let bulk approval bypass dual review", async () => {
    const { repository, calls } = createRecordingRepository();
    const halfReviewed = atStatus("review_submitted", {
      id: "lexeme|article|article.a|1|0|sismo",
      surfaceText: "sismo",
      normalizedText: "sismo",
      lemma: "sismo",
      partOfSpeech: null,
    });
    const forged = lowRiskCandidate("terremoto", {
      status: "review_ready",
      revision: 4,
      reviews: [{ dimension: "content-es-ES", outcome: "pass", reviewerReference: OWNER, reviewedAt: now }],
    });

    const partial = await approveCandidateBatch(repository, {
      ...batch,
      requests: [{ candidate: halfReviewed, frozen: FROZEN }],
    });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.code).toBe("CANDIDATE_INVALID_TRANSITION");

    const incomplete = await approveCandidateBatch(repository, {
      ...batch,
      requests: [{ candidate: forged, frozen: FROZEN }],
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) expect(incomplete.code).toBe("CANDIDATE_REVIEW_INCOMPLETE");

    expect(calls).toHaveLength(0);
  });

  it("refuses a batch that mixes sources", async () => {
    const { repository, calls } = createRecordingRepository();
    const candidateOne = readyFrom(lowRiskCandidate("terremoto"));
    const candidateTwo = readyFrom(lowRiskCandidate("sismo"));
    const outcome = await approveCandidateBatch(repository, {
      ...batch,
      requests: [
        { candidate: candidateOne, frozen: FROZEN },
        { candidate: candidateTwo, frozen: { ...FROZEN, documentVersion: 2 } },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("CANDIDATE_SOURCE_MISMATCH");
    expect(outcome.violations).toEqual([{ candidateId: candidateTwo.id, code: "CANDIDATE_SOURCE_MISMATCH" }]);
    expect(calls).toHaveLength(0);
  });

  it("refuses a batch whose approver is not owner-authorized", async () => {
    const { repository, calls } = createRecordingRepository();
    const ready = readyFrom(lowRiskCandidate("terremoto"));
    const outcome = await approveCandidateBatch(repository, {
      ...batch,
      approvedBy: "owner",
      requests: [{ candidate: ready, frozen: FROZEN }],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("CANDIDATE_REVIEWER_NOT_AUTHORIZED");
    expect(outcome.violations).toEqual([{ candidateId: ready.id, code: "CANDIDATE_REVIEWER_NOT_AUTHORIZED" }]);
    expect(calls).toHaveLength(0);
  });

  it("refuses a batch that contains an already-approved candidate", async () => {
    const { repository, calls } = createRecordingRepository();
    const approved = atStatus("approved", {
      id: "lexeme|article|article.a|1|0|sismo",
      surfaceText: "sismo",
      normalizedText: "sismo",
      lemma: "sismo",
      partOfSpeech: null,
    });
    const ready = readyFrom(lowRiskCandidate("terremoto"));
    const outcome = await approveCandidateBatch(repository, {
      ...batch,
      requests: [
        { candidate: ready, frozen: FROZEN },
        { candidate: approved, frozen: FROZEN },
      ],
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("CANDIDATE_INVALID_TRANSITION");
    expect(calls).toHaveLength(0);
  });

  it("treats an empty batch as a no-op", async () => {
    const { repository, calls } = createRecordingRepository();
    const outcome = await approveCandidateBatch(repository, { ...batch, requests: [] });
    expect(outcome).toEqual({ ok: true, approved: [], audits: [], lexemes: 0, phrases: 0 });
    expect(calls).toHaveLength(0);
  });
});
