import { and, desc, eq, or } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import {
  ContentAcquisitionConflictError,
  assertCandidatePublishable,
  resolveCandidateIdentity,
} from "../domain";
import type { RegisterContentSourceInput } from "../schemas";
import type {
  CommitDiscoveryPageInput,
  ContentAcquisitionRepository,
  ContentCandidateRecord,
  ContentSourceRecord,
  ContentWorkflowRepository,
  ProcessingAttemptInput,
} from "./content-acquisition-repository";
import type { CandidateReviewRecord } from "../domain";
import type { CandidatePublicationRef } from "../publishers";

function sourceRecord(
  row: typeof schema.acquisitionSources.$inferSelect,
  includeRightsPolicy = false,
): ContentSourceRecord {
  return {
    id: row.id,
    stableKey: row.stableKey,
    adapterType: row.adapterType as ContentSourceRecord["adapterType"],
    sourceKind: row.sourceKind as ContentSourceRecord["sourceKind"],
    externalSourceId: row.externalSourceId,
    displayName: row.displayName,
    language: row.language,
    region: row.region,
    enabled: row.enabled,
    rightsStatus: row.rightsStatus as ContentSourceRecord["rightsStatus"],
    ...(includeRightsPolicy ? { rightsPolicy: row.rightsPolicy } : {}),
    cursor: row.cursor,
    revision: row.revision,
  };
}

function candidateRecord(row: typeof schema.contentCandidates.$inferSelect): ContentCandidateRecord {
  return {
    id: row.id,
    sourceId: row.sourceId,
    externalItemId: row.externalItemId,
    normalizedUrl: row.normalizedUrl,
    title: row.title,
    language: row.language,
    metadata: row.metadata,
    publishedAt: row.publishedAt,
    contentHash: row.contentHash,
    contentType: row.contentType as ContentCandidateRecord["contentType"],
    status: row.status as ContentCandidateRecord["status"],
    rightsStatus: row.rightsStatus as ContentCandidateRecord["rightsStatus"],
    generationId: row.generationId,
    revision: row.revision,
    lastActivityAt: row.lastActivityAt,
    rejectedAt: row.rejectedAt,
    publicationStatus: row.publicationStatus as ContentCandidateRecord["publicationStatus"],
    publicationRef: row.publicationRef as CandidatePublicationRef | null,
    publishedCandidateRevision: row.publishedCandidateRevision,
    publishedContentHash: row.publishedContentHash,
    publishedAtInternal: row.publishedAtInternal,
    archivedAt: row.archivedAt,
  };
}

function reviewRecord(row: typeof schema.candidateReviews.$inferSelect): CandidateReviewRecord {
  return {
    id: row.id,
    candidateId: row.candidateId,
    dimension: row.dimension as CandidateReviewRecord["dimension"],
    status: row.status as CandidateReviewRecord["status"],
    reviewerReference: row.reviewerReference,
    candidateRevision: row.candidateRevision,
    notes: row.notes,
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceConfigMatches(
  row: typeof schema.acquisitionSources.$inferSelect,
  input: RegisterContentSourceInput,
): boolean {
  return row.displayName === input.displayName
    && row.language === input.language
    && row.region === input.region
    && row.enabled === input.enabled
    && row.rightsStatus === input.rightsStatus
    && row.cursor === input.cursor
    && jsonEqual(row.rightsPolicy, input.rightsPolicy)
    && jsonEqual(row.schedule, input.schedule)
    && jsonEqual(row.rateLimit, input.rateLimit);
}

export function createDrizzleContentAcquisitionRepository(
  database: Database,
): ContentAcquisitionRepository & ContentWorkflowRepository {
  async function findIdentities(
    executor: Pick<Database, "select">,
    candidate: CommitDiscoveryPageInput["candidates"][number],
  ) {
    const identityConditions = [
      and(
        eq(schema.contentCandidates.sourceId, candidate.sourceId),
        eq(schema.contentCandidates.externalItemId, candidate.externalItemId),
      ),
      eq(schema.contentCandidates.normalizedUrl, candidate.normalizedUrl),
    ];
    if (candidate.contentHash !== null) {
      identityConditions.push(eq(schema.contentCandidates.contentHash, candidate.contentHash));
    }
    return executor
      .select({
        candidateId: schema.contentCandidates.id,
        sourceId: schema.contentCandidates.sourceId,
        externalItemId: schema.contentCandidates.externalItemId,
        normalizedUrl: schema.contentCandidates.normalizedUrl,
        contentHash: schema.contentCandidates.contentHash,
      })
      .from(schema.contentCandidates)
      .where(or(...identityConditions));
  }

  return {
    async listSources() {
      const rows = await database.select().from(schema.acquisitionSources).orderBy(schema.acquisitionSources.displayName);
      return rows.map((row) => sourceRecord(row));
    },

    async listRuns(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
      const query = database.select().from(schema.acquisitionRuns);
      const rows = input.sourceId
        ? await query.where(eq(schema.acquisitionRuns.sourceId, input.sourceId)).orderBy(desc(schema.acquisitionRuns.startedAt)).limit(limit)
        : await query.orderBy(desc(schema.acquisitionRuns.startedAt)).limit(limit);
      return rows.map((row) => ({
        id: row.id,
        sourceId: row.sourceId,
        generationId: row.generationId,
        status: row.status as "running" | "succeeded" | "failed" | "cancelled",
        initialCursor: row.initialCursor,
        committedCursor: row.committedCursor,
        insertedCount: row.insertedCount,
        duplicateCount: row.duplicateCount,
        conflictCount: row.conflictCount,
        estimatedCostMicros: row.estimatedCostMicros,
        errorCode: row.errorCode,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
      }));
    },

    async findRunById(runId) {
      const [row] = await database.select().from(schema.acquisitionRuns).where(eq(schema.acquisitionRuns.id, runId)).limit(1);
      return row ? {
        id: row.id, sourceId: row.sourceId, generationId: row.generationId,
        status: row.status as "running" | "succeeded" | "failed" | "cancelled",
        initialCursor: row.initialCursor, committedCursor: row.committedCursor,
        insertedCount: row.insertedCount, duplicateCount: row.duplicateCount,
        conflictCount: row.conflictCount, estimatedCostMicros: row.estimatedCostMicros,
        errorCode: row.errorCode, startedAt: row.startedAt, completedAt: row.completedAt,
      } : null;
    },

    async listCandidates(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
      const conditions = [];
      if (input.status) conditions.push(eq(schema.contentCandidates.status, input.status));
      if (input.contentType) conditions.push(eq(schema.contentCandidates.contentType, input.contentType));
      const query = database.select().from(schema.contentCandidates);
      const rows = conditions.length
        ? await query.where(and(...conditions)).orderBy(desc(schema.contentCandidates.lastActivityAt)).limit(limit)
        : await query.orderBy(desc(schema.contentCandidates.lastActivityAt)).limit(limit);
      return rows.map(candidateRecord);
    },

    async getCandidateReview(candidateId) {
      const [candidate] = await database.select().from(schema.contentCandidates).where(eq(schema.contentCandidates.id, candidateId)).limit(1);
      if (!candidate) return null;
      const [source, artifacts, attempts, reviews] = await Promise.all([
        database.select().from(schema.acquisitionSources).where(eq(schema.acquisitionSources.id, candidate.sourceId)).limit(1),
        database.select().from(schema.candidateArtifacts).where(eq(schema.candidateArtifacts.candidateId, candidateId)).orderBy(schema.candidateArtifacts.createdAt),
        database.select().from(schema.candidateProcessingAttempts).where(eq(schema.candidateProcessingAttempts.candidateId, candidateId)).orderBy(desc(schema.candidateProcessingAttempts.startedAt)),
        database.select().from(schema.candidateReviews).where(eq(schema.candidateReviews.candidateId, candidateId)).orderBy(desc(schema.candidateReviews.updatedAt)),
      ]);
      if (!source[0]) throw new Error("CONTENT_SOURCE_NOT_FOUND");
      return {
        candidate: candidateRecord(candidate),
        source: sourceRecord(source[0]),
        artifacts: artifacts.map((row) => ({ id: row.id, artifactType: row.artifactType, contentHash: row.contentHash, byteSize: row.byteSize, status: row.status, ephemeral: row.ephemeral })),
        attempts: attempts.map((row) => ({ id: row.id, jobType: row.jobType, generationId: row.generationId, status: row.status, estimatedCostMicros: row.estimatedCostMicros, errorCode: row.errorCode, startedAt: row.startedAt, completedAt: row.completedAt })),
        reviews: reviews.map(reviewRecord),
      };
    },

    async registerSource(input) {
      const [stable] = await database
        .select()
        .from(schema.acquisitionSources)
        .where(eq(schema.acquisitionSources.stableKey, input.stableKey))
        .limit(1);
      if (stable) {
        if (
          stable.adapterType !== input.adapterType
          || stable.externalSourceId !== input.externalSourceId
          || stable.sourceKind !== input.sourceKind
        ) {
          throw new ContentAcquisitionConflictError("A stable source cannot change adapter identity or source kind.");
        }
        if (sourceConfigMatches(stable, input)) return sourceRecord(stable);
        const [updated] = await database
          .update(schema.acquisitionSources)
          .set({
            displayName: input.displayName,
            language: input.language,
            region: input.region,
            enabled: input.enabled,
            rightsStatus: input.rightsStatus,
            rightsPolicy: input.rightsPolicy,
            schedule: input.schedule,
            rateLimit: input.rateLimit,
            cursor: input.cursor,
            revision: stable.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.acquisitionSources.id, stable.id),
            eq(schema.acquisitionSources.revision, stable.revision),
          ))
          .returning();
        if (!updated) throw new ContentAcquisitionConflictError("Content source changed during registration.");
        return sourceRecord(updated);
      }

      const [sameExternalIdentity] = await database
        .select({ id: schema.acquisitionSources.id })
        .from(schema.acquisitionSources)
        .where(and(
          eq(schema.acquisitionSources.adapterType, input.adapterType),
          eq(schema.acquisitionSources.externalSourceId, input.externalSourceId),
        ))
        .limit(1);
      if (sameExternalIdentity) {
        throw new ContentAcquisitionConflictError("The adapter source identity is already registered.");
      }

      const [created] = await database
        .insert(schema.acquisitionSources)
        .values(input)
        .returning();
      if (!created) throw new Error("CONTENT_SOURCE_WRITE_FAILED");
      return sourceRecord(created);
    },

    async findSourceByStableKey(stableKey) {
      const [row] = await database
        .select()
        .from(schema.acquisitionSources)
        .where(eq(schema.acquisitionSources.stableKey, stableKey))
        .limit(1);
      return row ? sourceRecord(row, true) : null;
    },

    async createRun(input) {
      await database.insert(schema.acquisitionRuns).values({
        id: input.id,
        sourceId: input.sourceId,
        generationId: input.generationId,
        initialCursor: input.initialCursor,
        startedAt: input.startedAt,
        status: "running",
      });
    },

    async commitDiscoveryPage(input) {
      return database.transaction(async (transaction) => {
        const [run] = await transaction
          .select({ sourceId: schema.acquisitionRuns.sourceId, status: schema.acquisitionRuns.status })
          .from(schema.acquisitionRuns)
          .where(eq(schema.acquisitionRuns.id, input.runId))
          .limit(1);
        if (!run || run.sourceId !== input.sourceId || run.status !== "running") {
          throw new ContentAcquisitionConflictError("Acquisition run is unavailable or already terminal.");
        }

        let inserted = 0;
        let duplicates = 0;
        let conflicts = 0;
        const insertedCandidateIds: string[] = [];
        for (const candidate of input.candidates) {
          const existing = await findIdentities(transaction, candidate);
          const resolution = resolveCandidateIdentity(existing, candidate);
          if (resolution.kind === "duplicate") {
            duplicates += 1;
            continue;
          }
          if (resolution.kind === "conflict") {
            conflicts += 1;
            continue;
          }

          const created = await transaction
            .insert(schema.contentCandidates)
            .values({
              id: candidate.id,
              sourceId: candidate.sourceId,
              externalItemId: candidate.externalItemId,
              normalizedUrl: candidate.normalizedUrl,
              title: candidate.title,
              contentType: candidate.contentType,
              language: candidate.language,
              publishedAt: candidate.publishedAt,
              contentHash: candidate.contentHash,
              metadata: candidate.metadata,
              status: "discovered",
              rightsStatus: candidate.rightsStatus,
              generationId: candidate.generationId,
              revision: 1,
              lastActivityAt: candidate.discoveredAt,
            })
            .onConflictDoNothing()
            .returning({ id: schema.contentCandidates.id });
          if (created.length > 0) {
            inserted += 1;
            insertedCandidateIds.push(candidate.id);
            continue;
          }
          const concurrent = await findIdentities(transaction, candidate);
          const concurrentResolution = resolveCandidateIdentity(concurrent, candidate);
          if (concurrentResolution.kind === "conflict") conflicts += 1;
          else duplicates += 1;
        }

        const updatedSources = await transaction
          .update(schema.acquisitionSources)
          .set({
            cursor: input.nextCursor,
            revision: input.expectedSourceRevision + 1,
            updatedAt: new Date(),
          })
          .where(and(
            eq(schema.acquisitionSources.id, input.sourceId),
            eq(schema.acquisitionSources.revision, input.expectedSourceRevision),
          ))
          .returning({ id: schema.acquisitionSources.id });
        if (updatedSources.length !== 1) {
          throw new ContentAcquisitionConflictError("Content source cursor changed during discovery.");
        }
        return { inserted, duplicates, conflicts, insertedCandidateIds };
      });
    },

    async completeRun(input) {
      const rows = await database
        .update(schema.acquisitionRuns)
        .set({
          status: "succeeded",
          committedCursor: input.committedCursor,
          insertedCount: input.inserted,
          duplicateCount: input.duplicates,
          conflictCount: input.conflicts,
          estimatedCostMicros: input.estimatedCostMicros,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(and(
          eq(schema.acquisitionRuns.id, input.runId),
          eq(schema.acquisitionRuns.status, "running"),
        ))
        .returning({ id: schema.acquisitionRuns.id });
      if (rows.length !== 1) throw new ContentAcquisitionConflictError("Acquisition run could not be completed.");
    },

    async failRun(input) {
      await database
        .update(schema.acquisitionRuns)
        .set({
          status: "failed",
          errorCode: input.errorCode,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        })
        .where(and(
          eq(schema.acquisitionRuns.id, input.runId),
          eq(schema.acquisitionRuns.status, "running"),
        ));
    },

    async findCandidateById(candidateId) {
      const [row] = await database
        .select()
        .from(schema.contentCandidates)
        .where(eq(schema.contentCandidates.id, candidateId))
        .limit(1);
      return row ? candidateRecord(row) : null;
    },

    async compareAndSwapCandidate(input) {
      const [row] = await database
        .update(schema.contentCandidates)
        .set({
          status: input.status,
          generationId: input.generationId,
          revision: input.expectedRevision + 1,
          lastActivityAt: input.updatedAt,
          rejectedAt: input.rejectedAt,
          updatedAt: input.updatedAt,
        })
        .where(and(
          eq(schema.contentCandidates.id, input.candidateId),
          eq(schema.contentCandidates.revision, input.expectedRevision),
          eq(schema.contentCandidates.generationId, input.expectedGenerationId),
        ))
        .returning();
      if (!row) throw new ContentAcquisitionConflictError("Candidate changed before the update was committed.");
      return candidateRecord(row);
    },

    async recordProcessingAttempt(input: ProcessingAttemptInput) {
      const created = await database
        .insert(schema.candidateProcessingAttempts)
        .values(input)
        .onConflictDoNothing()
        .returning({ id: schema.candidateProcessingAttempts.id });
      if (created.length > 0) return;
      const [existing] = await database
        .select()
        .from(schema.candidateProcessingAttempts)
        .where(and(
          eq(schema.candidateProcessingAttempts.jobId, input.jobId),
          eq(schema.candidateProcessingAttempts.generationId, input.generationId),
        ))
        .limit(1);
      if (
        !existing
        || existing.candidateId !== input.candidateId
        || existing.jobType !== input.jobType
        || existing.expectedRevision !== input.expectedRevision
      ) {
        throw new ContentAcquisitionConflictError("Processing attempt idempotency key conflicts with existing input.");
      }
    },

    async saveCandidateReview(input) {
      return database.transaction(async (transaction) => {
        const [candidate] = await transaction.select({ revision: schema.contentCandidates.revision, status: schema.contentCandidates.status, publicationStatus: schema.contentCandidates.publicationStatus }).from(schema.contentCandidates).where(eq(schema.contentCandidates.id, input.candidateId)).limit(1).for("update");
        if (!candidate || candidate.revision !== input.expectedRevision) throw new ContentAcquisitionConflictError("Candidate revision changed before review submission.");
        if (!['review_ready', 'rejected'].includes(candidate.status)) throw new ContentAcquisitionConflictError("Candidate is not available for review.");
        if (candidate.publicationStatus !== "draft") throw new ContentAcquisitionConflictError("Published or archived candidates cannot receive draft reviews.");
        const [previousReview] = await transaction.select({ notes: schema.candidateReviews.notes }).from(schema.candidateReviews).where(and(
          eq(schema.candidateReviews.candidateId, input.candidateId),
          eq(schema.candidateReviews.dimension, input.dimension),
          eq(schema.candidateReviews.candidateRevision, input.expectedRevision),
        )).limit(1);
        const preservedNotes = input.notes
          ? [previousReview?.notes, `[${input.status}] ${input.notes}`].filter(Boolean).join("\n\n")
          : previousReview?.notes ?? null;
        const [review] = await transaction.insert(schema.candidateReviews).values({
          id: input.id,
          candidateId: input.candidateId,
          dimension: input.dimension,
          status: input.status,
          reviewerReference: input.reviewerReference,
          candidateRevision: input.expectedRevision,
          notes: preservedNotes,
          updatedAt: input.updatedAt,
        }).onConflictDoUpdate({
          target: [schema.candidateReviews.candidateId, schema.candidateReviews.dimension, schema.candidateReviews.candidateRevision],
          set: { status: input.status, reviewerReference: input.reviewerReference, notes: preservedNotes, updatedAt: input.updatedAt },
        }).returning();
        if (!review) throw new Error("CONTENT_REVIEW_WRITE_FAILED");
        if (input.status === "rejected") {
          const rejected = await transaction.update(schema.contentCandidates).set({ status: "rejected", rejectedAt: input.updatedAt, lastActivityAt: input.updatedAt, updatedAt: input.updatedAt }).where(and(eq(schema.contentCandidates.id, input.candidateId), eq(schema.contentCandidates.revision, input.expectedRevision), eq(schema.contentCandidates.publicationStatus, "draft"))).returning({ id: schema.contentCandidates.id });
          if (rejected.length !== 1) throw new ContentAcquisitionConflictError("Candidate changed while the rejection was recorded.");
        }
        return reviewRecord(review);
      });
    },

    async requestCandidateReprocessing(input) {
      const [row] = await database.update(schema.contentCandidates).set({
        status: "processing",
        generationId: input.generationId,
        revision: input.expectedRevision + 1,
        rejectedAt: null,
        lastActivityAt: input.updatedAt,
        updatedAt: input.updatedAt,
      }).where(and(
        eq(schema.contentCandidates.id, input.candidateId),
        eq(schema.contentCandidates.revision, input.expectedRevision),
        or(eq(schema.contentCandidates.status, "review_ready"), eq(schema.contentCandidates.status, "rejected"), eq(schema.contentCandidates.status, "failed")),
        eq(schema.contentCandidates.publicationStatus, "draft"),
      )).returning();
      if (!row) throw new ContentAcquisitionConflictError("Candidate cannot be reprocessed from its current state.");
      return candidateRecord(row);
    },

    async markCandidatePublished(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(schema.contentCandidates).where(eq(schema.contentCandidates.id, input.candidateId)).limit(1).for("update");
        if (!current) throw new ContentAcquisitionConflictError("Candidate changed before publication was recorded.");
        const reviews = await transaction.select().from(schema.candidateReviews).where(and(
          eq(schema.candidateReviews.candidateId, input.candidateId),
          eq(schema.candidateReviews.candidateRevision, input.expectedRevision),
        ));
        assertCandidatePublishable(candidateRecord(current), reviews.map(reviewRecord), {
          expectedRevision: input.expectedRevision,
          expectedContentHash: input.expectedContentHash,
        });
        const [row] = await transaction.update(schema.contentCandidates).set({
          publicationStatus: "published",
          publicationRef: input.publicationRef,
          publishedCandidateRevision: input.expectedRevision,
          publishedContentHash: input.expectedContentHash,
          publishedAtInternal: input.publishedAt,
          archivedAt: null,
          lastActivityAt: input.publishedAt,
          updatedAt: input.publishedAt,
        }).where(and(
          eq(schema.contentCandidates.id, input.candidateId),
          eq(schema.contentCandidates.revision, input.expectedRevision),
          eq(schema.contentCandidates.contentHash, input.expectedContentHash),
          eq(schema.contentCandidates.status, "review_ready"),
          eq(schema.contentCandidates.rightsStatus, "verified"),
          eq(schema.contentCandidates.publicationStatus, "draft"),
        )).returning();
        if (!row) throw new ContentAcquisitionConflictError("Candidate changed before publication was recorded.");
        await transaction.insert(schema.candidateReviews).values({
          id: input.reviewId,
          candidateId: input.candidateId,
          dimension: "owner-release",
          status: "approved",
          reviewerReference: input.reviewerReference,
          candidateRevision: input.expectedRevision,
          notes: `Published ${input.publicationRef.kind}:${input.publicationRef.stableKey}@${input.publicationRef.version}`,
          updatedAt: input.publishedAt,
        });
        return candidateRecord(row);
      });
    },

    async markCandidateArchived(input) {
      return database.transaction(async (transaction) => {
        const [current] = await transaction.select().from(schema.contentCandidates).where(and(
          eq(schema.contentCandidates.id, input.candidateId),
          eq(schema.contentCandidates.revision, input.expectedRevision),
          eq(schema.contentCandidates.publicationStatus, "published"),
        )).limit(1);
        if (!current || JSON.stringify(current.publicationRef) !== JSON.stringify(input.publicationRef)) throw new ContentAcquisitionConflictError("Published candidate changed before archival.");
        const [row] = await transaction.update(schema.contentCandidates).set({
          publicationStatus: "archived",
          archivedAt: input.archivedAt,
          lastActivityAt: input.archivedAt,
          updatedAt: input.archivedAt,
        }).where(and(
          eq(schema.contentCandidates.id, input.candidateId),
          eq(schema.contentCandidates.revision, input.expectedRevision),
          eq(schema.contentCandidates.publicationStatus, "published"),
        )).returning();
        if (!row) throw new ContentAcquisitionConflictError("Published candidate changed before archival.");
        return candidateRecord(row);
      });
    },
  };
}
