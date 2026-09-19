import type {
  CandidatePublicationStatus,
  CandidateReviewDimension,
  CandidateReviewRecord,
  CandidateReviewStatus,
  CandidateState,
  CandidateStatus,
  SourceRightsStatus,
} from "../domain";
import type { CandidatePublicationRef } from "../publishers";
import type {
  ContentCandidateType,
  RegisterContentSourceInput,
  SourceAdapterType,
  SourceKind,
} from "../schemas";

export type ContentSourceRecord = Readonly<{
  id: string;
  stableKey: string;
  adapterType: SourceAdapterType;
  sourceKind: SourceKind;
  externalSourceId: string;
  displayName: string;
  language: string;
  region: string | null;
  enabled: boolean;
  rightsStatus: SourceRightsStatus;
  rightsPolicy?: Readonly<Record<string, unknown>>;
  cursor: string | null;
  revision: number;
}>;

export type ContentCandidateRecord = CandidateState & Readonly<{
  id: string;
  sourceId: string;
  externalItemId: string;
  normalizedUrl: string;
  title: string;
  language: string;
  metadata: Readonly<Record<string, unknown>>;
  publishedAt: Date | null;
  contentHash: string | null;
  contentType: ContentCandidateType;
  rightsStatus: SourceRightsStatus;
  lastActivityAt: Date;
  rejectedAt: Date | null;
  publicationStatus: CandidatePublicationStatus;
  publicationRef: CandidatePublicationRef | null;
  publishedCandidateRevision: number | null;
  publishedContentHash: string | null;
  publishedAtInternal: Date | null;
  archivedAt: Date | null;
}>;

export type AcquisitionRunRecord = Readonly<{
  id: string;
  sourceId: string;
  generationId: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  initialCursor: string | null;
  committedCursor: string | null;
  insertedCount: number;
  duplicateCount: number;
  conflictCount: number;
  estimatedCostMicros: number;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}>;

export type CandidateArtifactRecord = Readonly<{
  id: string;
  artifactType: string;
  contentHash: string | null;
  byteSize: number;
  status: string;
  ephemeral: boolean;
}>;

export type ContentCleanupArtifactRecord = Readonly<{
  id: string;
  kind: string;
  byteSize: number;
  ephemeral: boolean;
  processingStatus: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
}>;

export type CandidateProcessingAttemptRecord = Readonly<{
  id: string;
  jobType: string;
  generationId: string;
  status: string;
  estimatedCostMicros: number;
  errorCode: string | null;
  startedAt: Date;
  completedAt: Date | null;
}>;

export type CandidateReviewDetail = Readonly<{
  candidate: ContentCandidateRecord;
  source: ContentSourceRecord;
  artifacts: readonly CandidateArtifactRecord[];
  attempts: readonly CandidateProcessingAttemptRecord[];
  reviews: readonly CandidateReviewRecord[];
}>;

export type DiscoveryCandidateInput = Readonly<{
  id: string;
  sourceId: string;
  externalItemId: string;
  normalizedUrl: string;
  title: string;
  contentType: ContentCandidateType;
  language: string;
  publishedAt: Date | null;
  contentHash: string | null;
  metadata: Readonly<Record<string, unknown>>;
  rightsStatus: SourceRightsStatus;
  generationId: string;
  discoveredAt: Date;
}>;

export type CommitDiscoveryPageInput = Readonly<{
  runId: string;
  sourceId: string;
  expectedSourceRevision: number;
  nextCursor: string | null;
  candidates: readonly DiscoveryCandidateInput[];
}>;

export type CommitDiscoveryPageResult = Readonly<{
  inserted: number;
  duplicates: number;
  conflicts: number;
  insertedCandidateIds: readonly string[];
}>;

export type ProcessingAttemptInput = Readonly<{
  id: string;
  candidateId: string;
  jobType: string;
  jobId: string;
  generationId: string;
  expectedRevision: number;
  status: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  estimatedCostMicros: number;
  startedAt: Date;
  completedAt: Date | null;
  errorCode: string | null;
}>;

export interface ContentAcquisitionRepository {
  registerSource(input: RegisterContentSourceInput): Promise<ContentSourceRecord>;
  findSourceByStableKey(stableKey: string): Promise<ContentSourceRecord | null>;
  findSourceById?(sourceId: string): Promise<ContentSourceRecord | null>;
  createRun(input: Readonly<{
    id: string;
    sourceId: string;
    generationId: string;
    initialCursor: string | null;
    startedAt: Date;
  }>): Promise<void>;
  commitDiscoveryPage(input: CommitDiscoveryPageInput): Promise<CommitDiscoveryPageResult>;
  completeRun(input: CommitDiscoveryPageResult & Readonly<{
    runId: string;
    committedCursor: string | null;
    estimatedCostMicros: number;
    completedAt: Date;
  }>): Promise<void>;
  failRun(input: Readonly<{
    runId: string;
    errorCode: string;
    completedAt: Date;
  }>): Promise<void>;
  findCandidateById(candidateId: string): Promise<ContentCandidateRecord | null>;
  compareAndSwapCandidate(input: Readonly<{
    candidateId: string;
    expectedRevision: number;
    expectedGenerationId: string;
    status: CandidateStatus;
    generationId: string;
    rejectedAt?: Date | null;
    metadata?: Readonly<Record<string, unknown>>;
    contentHash?: string | null;
    updatedAt: Date;
  }>): Promise<ContentCandidateRecord>;
  recordProcessingAttempt(input: ProcessingAttemptInput): Promise<void>;
  listCandidatesForCleanup?(input: Readonly<{ limit: number }>): Promise<readonly ContentCandidateRecord[]>;
  listCandidateArtifactsForCleanup?(candidateId: string): Promise<readonly ContentCleanupArtifactRecord[]>;
  deleteCandidateArtifact?(artifactId: string): Promise<void>;
  purgeCandidate?(candidateId: string): Promise<void>;
}

export interface ContentWorkflowRepository {
  listSources(): Promise<readonly ContentSourceRecord[]>;
  findSourceById?(sourceId: string): Promise<ContentSourceRecord | null>;
  listRuns(input?: Readonly<{ sourceId?: string; limit?: number }>): Promise<readonly AcquisitionRunRecord[]>;
  findRunById(runId: string): Promise<AcquisitionRunRecord | null>;
  listCandidates(input?: Readonly<{ sourceId?: string; status?: CandidateStatus; contentType?: ContentCandidateType; limit?: number }>): Promise<readonly ContentCandidateRecord[]>;
  findCandidateById(candidateId: string): Promise<ContentCandidateRecord | null>;
  getCandidateReview(candidateId: string): Promise<CandidateReviewDetail | null>;
  saveCandidateReview(input: Readonly<{
    id: string;
    candidateId: string;
    expectedRevision: number;
    dimension: CandidateReviewDimension;
    status: CandidateReviewStatus;
    reviewerReference: string;
    notes: string | null;
    updatedAt: Date;
  }>): Promise<CandidateReviewRecord>;
  requestCandidateReprocessing(input: Readonly<{
    candidateId: string;
    expectedRevision: number;
    generationId: string;
    updatedAt: Date;
  }>): Promise<ContentCandidateRecord>;
  markCandidatePublished(input: Readonly<{
    reviewId: string;
    candidateId: string;
    expectedRevision: number;
    expectedContentHash: string;
    publicationRef: CandidatePublicationRef;
    reviewerReference: string;
    publishedAt: Date;
  }>): Promise<ContentCandidateRecord>;
  markCandidateArchived(input: Readonly<{
    candidateId: string;
    expectedRevision: number;
    publicationRef: CandidatePublicationRef;
    archivedAt: Date;
  }>): Promise<ContentCandidateRecord>;
  recordProcessingAttempt?(input: ProcessingAttemptInput): Promise<void>;
}
