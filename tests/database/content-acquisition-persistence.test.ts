// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDrizzleContentAcquisitionRepository,
  processCandidate,
} from "@/src/modules/content-acquisition";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const sourceId = "00000000-0000-4000-8000-000000000501";
const candidateId = "00000000-0000-4000-8000-000000000502";
const runId = "00000000-0000-4000-8000-000000000503";

async function acquisitionMigration(): Promise<string> {
  const names = (await readdir(path.join(process.cwd(), "drizzle")))
    .filter((name) => /^002[12]_.+\.sql$/u.test(name)).sort();
  expect(names).toHaveLength(2);
  return (await Promise.all(names.map((name) => readFile(path.join(process.cwd(), "drizzle", name), "utf8"))))
    .join("\n").replaceAll("--> statement-breakpoint", "");
}

describe("content acquisition persistence", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    await client.exec(await acquisitionMigration());
    database = drizzle(client, { schema });
  });

  afterEach(async () => {
    await client.close();
  });

  function repository() {
    return createDrizzleContentAcquisitionRepository(database as unknown as Database);
  }

  async function registerSource() {
    return repository().registerSource({
      id: sourceId,
      stableKey: "fixture.spanish.daily",
      adapterType: "fake",
      sourceKind: "video-channel",
      externalSourceId: "fixture-channel",
      displayName: "Fixture Spanish",
      language: "es",
      region: "es-ES",
      enabled: true,
      rightsStatus: "verified",
      rightsPolicy: { acquisition: "fixture-only" },
      schedule: { cadence: "daily" },
      rateLimit: { requestsPerMinute: 1 },
      cursor: "page-1",
    });
  }

  it("registers sources idempotently and updates mutable configuration by revision", async () => {
    const acquisition = repository();
    const first = await registerSource();
    const repeated = await registerSource();
    expect(repeated).toEqual(first);
    expect(await acquisition.listSources()).toEqual([
      expect.objectContaining({ rightsPolicy: { acquisition: "fixture-only" } }),
    ]);

    const updated = await acquisition.registerSource({
      id: sourceId,
      stableKey: "fixture.spanish.daily",
      adapterType: "fake",
      sourceKind: "video-channel",
      externalSourceId: "fixture-channel",
      displayName: "Fixture Spanish Daily",
      language: "es",
      region: "es-ES",
      enabled: true,
      rightsStatus: "verified",
      rightsPolicy: { acquisition: "fixture-only" },
      schedule: { cadence: "daily" },
      rateLimit: { requestsPerMinute: 1 },
      cursor: "page-1",
    });
    expect(updated).toMatchObject({ displayName: "Fixture Spanish Daily", revision: 2 });

    await expect(acquisition.registerSource({
      id: "00000000-0000-4000-8000-000000000599",
      stableKey: "fixture.conflict",
      adapterType: "fake",
      sourceKind: "video-channel",
      externalSourceId: "fixture-channel",
      displayName: "Conflict",
      language: "es",
      region: null,
      enabled: true,
      rightsStatus: "verified",
      rightsPolicy: {},
      schedule: {},
      rateLimit: {},
      cursor: null,
    })).rejects.toThrow("already registered");
  });

  it("commits candidates and the cursor atomically, then deduplicates a replay", async () => {
    const acquisition = repository();
    const source = await registerSource();
    await acquisition.createRun({
      id: runId,
      sourceId,
      generationId: "generation-1",
      initialCursor: "page-1",
      startedAt: new Date("2026-09-13T00:00:00.000Z"),
    });
    const candidate = {
      id: candidateId,
      sourceId,
      externalItemId: "video-1",
      normalizedUrl: "https://example.test/watch?v=1",
      title: "Fixture video",
      contentType: "video" as const,
      language: "es",
      publishedAt: new Date("2026-09-12T00:00:00.000Z"),
      contentHash: "a".repeat(64),
      metadata: { durationSeconds: 120 },
      rightsStatus: "verified" as const,
      generationId: "generation-1",
      discoveredAt: new Date("2026-09-13T00:00:00.000Z"),
    };
    const committed = await acquisition.commitDiscoveryPage({
      runId,
      sourceId,
      expectedSourceRevision: source.revision,
      nextCursor: "page-2",
      candidates: [candidate],
    });
    expect(committed).toEqual({ inserted: 1, duplicates: 0, conflicts: 0, insertedCandidateIds: [candidateId] });
    await acquisition.completeRun({
      runId,
      ...committed,
      committedCursor: "page-2",
      estimatedCostMicros: 0,
      completedAt: new Date("2026-09-13T00:00:01.000Z"),
    });
    await expect(acquisition.findSourceByStableKey("fixture.spanish.daily")).resolves.toMatchObject({
      cursor: "page-2",
      revision: 2,
    });

    const secondRunId = "00000000-0000-4000-8000-000000000504";
    await acquisition.createRun({
      id: secondRunId,
      sourceId,
      generationId: "generation-2",
      initialCursor: "page-2",
      startedAt: new Date("2026-09-14T00:00:00.000Z"),
    });
    await expect(acquisition.commitDiscoveryPage({
      runId: secondRunId,
      sourceId,
      expectedSourceRevision: 2,
      nextCursor: "page-3",
      candidates: [{ ...candidate, id: "00000000-0000-4000-8000-000000000505", generationId: "generation-2" }],
    })).resolves.toEqual({ inserted: 0, duplicates: 1, conflicts: 0, insertedCandidateIds: [] });

    const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(schema.contentCandidates);
    expect(Number(count)).toBe(1);
  });

  it("rolls the candidate insert back when the source revision is stale", async () => {
    const acquisition = repository();
    await registerSource();
    await acquisition.createRun({
      id: runId,
      sourceId,
      generationId: "generation-1",
      initialCursor: "page-1",
      startedAt: new Date("2026-09-13T00:00:00.000Z"),
    });

    await expect(acquisition.commitDiscoveryPage({
      runId,
      sourceId,
      expectedSourceRevision: 99,
      nextCursor: "page-2",
      candidates: [{
        id: candidateId,
        sourceId,
        externalItemId: "video-stale",
        normalizedUrl: "https://example.test/stale",
        title: "Stale",
        contentType: "video",
        language: "es",
        publishedAt: null,
        contentHash: "b".repeat(64),
        metadata: {},
        rightsStatus: "verified",
        generationId: "generation-1",
        discoveredAt: new Date("2026-09-13T00:00:00.000Z"),
      }],
    })).rejects.toThrow("cursor changed");

    const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(schema.contentCandidates);
    expect(Number(count)).toBe(0);
    const [row] = await database.select().from(schema.acquisitionSources).where(eq(schema.acquisitionSources.id, sourceId));
    expect(row?.cursor).toBe("page-1");
  });

  it("persists candidate CAS transitions and idempotent processing attempts", async () => {
    const acquisition = repository();
    const source = await registerSource();
    await acquisition.createRun({
      id: runId,
      sourceId,
      generationId: "generation-1",
      initialCursor: "page-1",
      startedAt: new Date("2026-09-13T00:00:00.000Z"),
    });
    await acquisition.commitDiscoveryPage({
      runId,
      sourceId,
      expectedSourceRevision: source.revision,
      nextCursor: "page-2",
      candidates: [{
        id: candidateId,
        sourceId,
        externalItemId: "video-cas",
        normalizedUrl: "https://example.test/cas",
        title: "CAS",
        contentType: "video",
        language: "es",
        publishedAt: null,
        contentHash: "c".repeat(64),
        metadata: {},
        rightsStatus: "verified",
        generationId: "generation-1",
        discoveredAt: new Date("2026-09-13T00:00:00.000Z"),
      }],
    });

    let expectedRevision = 1;
    for (const type of ["screen-approved", "start-acquisition", "start-processing", "mark-review-ready"] as const) {
      const next = await processCandidate(acquisition, {
        candidateId,
        event: { type, expectedRevision, generationId: "generation-1" },
        now: () => new Date("2026-09-13T01:00:00.000Z"),
      });
      expectedRevision = next.revision;
    }
    await expect(acquisition.findCandidateById(candidateId)).resolves.toMatchObject({ status: "review_ready", revision: 5 });

    const attempt = {
      id: "00000000-0000-4000-8000-000000000506",
      candidateId,
      jobType: "metadata-normalization",
      jobId: "job-1",
      generationId: "generation-1",
      expectedRevision: 3,
      status: "succeeded" as const,
      estimatedCostMicros: 0,
      startedAt: new Date("2026-09-13T00:30:00.000Z"),
      completedAt: new Date("2026-09-13T00:30:01.000Z"),
      errorCode: null,
    };
    await acquisition.recordProcessingAttempt(attempt);
    await acquisition.recordProcessingAttempt(attempt);
    const [{ count }] = await database.select({ count: sql<number>`count(*)` }).from(schema.candidateProcessingAttempts);
    expect(Number(count)).toBe(1);
    await expect(acquisition.recordProcessingAttempt({ ...attempt, jobType: "different" })).rejects.toThrow("conflicts");
  });
});
