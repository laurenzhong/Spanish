import { describe, expect, it } from "vitest";

import {
  ContentSourceDisabledError,
  ContentSourceNotFoundError,
  FakeContentSourceAdapter,
  runAcquisitionSource,
  type CommitDiscoveryPageInput,
  type ContentAcquisitionRepository,
  type ContentSourceRecord,
} from "@/src/modules/content-acquisition";

function source(overrides: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    stableKey: "fixture.spanish.daily",
    adapterType: "fake",
    sourceKind: "video-channel",
    externalSourceId: "fixture-channel",
    displayName: "Fixture Spanish",
    language: "es",
    region: "es-ES",
    enabled: true,
    rightsStatus: "verified",
    cursor: "page-1",
    revision: 1,
    ...overrides,
  };
}

function repository(currentSource: ContentSourceRecord | null) {
  const commits: CommitDiscoveryPageInput[] = [];
  const runs: string[] = [];
  let failCommit = false;
  const value: ContentAcquisitionRepository = {
    registerSource: async () => { throw new Error("unused"); },
    findSourceByStableKey: async () => currentSource,
    createRun: async (input) => { runs.push(input.id); },
    commitDiscoveryPage: async (input) => {
      if (failCommit) throw new Error("database unavailable");
      commits.push(input);
      if (currentSource) currentSource = { ...currentSource, cursor: input.nextCursor, revision: currentSource.revision + 1 };
      return { inserted: input.candidates.length, duplicates: 0, conflicts: 0, insertedCandidateIds: input.candidates.map((candidate) => candidate.id) };
    },
    completeRun: async () => undefined,
    failRun: async () => undefined,
    findCandidateById: async () => null,
    compareAndSwapCandidate: async () => { throw new Error("unused"); },
    recordProcessingAttempt: async () => undefined,
  };
  return { value, commits, runs, setFailCommit: () => { failCommit = true; }, readSource: () => currentSource };
}

const page = {
  sourceStableKey: "fixture.spanish.daily",
  cursor: "page-1",
  nextCursor: "page-2",
  estimatedCostMicros: 0,
  items: [{
    externalItemId: "video-001",
    canonicalUrl: "https://example.test/watch?v=video-001",
    title: "Una conversación cotidiana",
    contentType: "video" as const,
    language: "es",
    publishedAt: "2026-09-12T08:00:00.000Z",
    contentHash: "1".repeat(64),
    metadata: {},
  }],
};

describe("run content acquisition source", () => {
  it("commits candidates and advances the cursor only as one repository operation", async () => {
    const state = repository(source());
    const result = await runAcquisitionSource({
      repository: state.value,
      adapter: new FakeContentSourceAdapter([page]),
      input: { sourceStableKey: "fixture.spanish.daily", dryRun: false, limit: 10 },
      dependencies: {
        now: () => new Date("2026-09-13T00:00:00.000Z"),
        makeRunId: () => "00000000-0000-4000-8000-000000000401",
        makeCandidateId: () => "00000000-0000-4000-8000-000000000402",
        makeGenerationId: () => "generation-1",
      },
    });

    expect(result).toMatchObject({ discovered: 1, inserted: 1, dryRun: false });
    expect(state.commits).toHaveLength(1);
    expect(state.commits[0]?.nextCursor).toBe("page-2");
    expect(state.readSource()?.cursor).toBe("page-2");
  });

  it("does not advance the cursor when the atomic page commit fails", async () => {
    const state = repository(source());
    state.setFailCommit();

    await expect(runAcquisitionSource({
      repository: state.value,
      adapter: new FakeContentSourceAdapter([page]),
      input: { sourceStableKey: "fixture.spanish.daily", dryRun: false, limit: 10 },
      dependencies: {
        now: () => new Date("2026-09-13T00:00:00.000Z"),
        makeRunId: () => "00000000-0000-4000-8000-000000000403",
        makeCandidateId: () => "00000000-0000-4000-8000-000000000404",
        makeGenerationId: () => "generation-1",
      },
    })).rejects.toThrow("database unavailable");

    expect(state.commits).toHaveLength(0);
    expect(state.readSource()?.cursor).toBe("page-1");
  });

  it("keeps dry-runs free of writes", async () => {
    const state = repository(source());
    const result = await runAcquisitionSource({
      repository: state.value,
      adapter: new FakeContentSourceAdapter([page]),
      input: { sourceStableKey: "fixture.spanish.daily", dryRun: true, limit: 1 },
      dependencies: {
        now: () => new Date("2026-09-13T00:00:00.000Z"),
        makeRunId: () => "dry-run-1",
        makeCandidateId: () => "candidate-dry-1",
        makeGenerationId: () => "generation-dry-1",
      },
    });

    expect(result).toMatchObject({ dryRun: true, discovered: 1, inserted: 0 });
    expect(state.runs).toHaveLength(0);
    expect(state.commits).toHaveLength(0);
  });

  it("fails closed for missing and disabled sources", async () => {
    const missing = repository(null);
    await expect(runAcquisitionSource({
      repository: missing.value,
      adapter: new FakeContentSourceAdapter([page]),
      input: { sourceStableKey: "missing", dryRun: true, limit: 1 },
    })).rejects.toBeInstanceOf(ContentSourceNotFoundError);

    const disabled = repository(source({ enabled: false }));
    await expect(runAcquisitionSource({
      repository: disabled.value,
      adapter: new FakeContentSourceAdapter([page]),
      input: { sourceStableKey: "fixture.spanish.daily", dryRun: true, limit: 1 },
    })).rejects.toBeInstanceOf(ContentSourceDisabledError);
  });
});
