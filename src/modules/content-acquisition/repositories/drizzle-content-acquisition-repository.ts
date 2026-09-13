import { and, eq, or } from "drizzle-orm";

import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";
import {
  ContentAcquisitionConflictError,
  resolveCandidateIdentity,
} from "../domain";
import type { RegisterContentSourceInput } from "../schemas";
import type {
  CommitDiscoveryPageInput,
  ContentAcquisitionRepository,
  ContentCandidateRecord,
  ContentSourceRecord,
  ProcessingAttemptInput,
} from "./content-acquisition-repository";

function sourceRecord(row: typeof schema.acquisitionSources.$inferSelect): ContentSourceRecord {
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
    contentHash: row.contentHash,
    contentType: row.contentType as ContentCandidateRecord["contentType"],
    status: row.status as ContentCandidateRecord["status"],
    rightsStatus: row.rightsStatus as ContentCandidateRecord["rightsStatus"],
    generationId: row.generationId,
    revision: row.revision,
    lastActivityAt: row.lastActivityAt,
    rejectedAt: row.rejectedAt,
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
): ContentAcquisitionRepository {
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
      return row ? sourceRecord(row) : null;
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
        return { inserted, duplicates, conflicts };
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
  };
}
