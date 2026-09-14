import { describe, expect, it, vi } from "vitest";

import {
  FakeContentSourceAdapter,
  type ContentAcquisitionRepository,
  type ContentSourceRecord,
} from "@/src/modules/content-acquisition";
import {
  AcquireContentCliInputError,
  parseAcquireContentArguments,
  runAcquireContentCli,
} from "@/scripts/acquire-content";

function dryRunRepository(): ContentAcquisitionRepository {
  const source = {
    id: "00000000-0000-4000-8000-000000000601",
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
  } satisfies ContentSourceRecord;
  return {
    registerSource: vi.fn(),
    findSourceByStableKey: vi.fn(async () => source),
    createRun: vi.fn(async () => { throw new Error("dry-run must not create a run"); }),
    commitDiscoveryPage: vi.fn(async () => { throw new Error("dry-run must not commit candidates"); }),
    completeRun: vi.fn(async () => { throw new Error("dry-run must not complete a run"); }),
    failRun: vi.fn(async () => { throw new Error("dry-run must not fail a run"); }),
    findCandidateById: vi.fn(),
    compareAndSwapCandidate: vi.fn(),
    recordProcessingAttempt: vi.fn(),
  };
}

describe("content acquisition CLI", () => {
  it("fails closed when no source is explicit or an argument is unsupported", () => {
    expect(() => parseAcquireContentArguments(["--", "--dry-run"])).toThrow(AcquireContentCliInputError);
    expect(() => parseAcquireContentArguments(["--source", "fixture", "--all"])).toThrow(
      AcquireContentCliInputError,
    );
  });

  it("parses the supported source, dry-run and limit flags", () => {
    expect(parseAcquireContentArguments([
      "--",
      "--source",
      "fixture.spanish.daily",
      "--dry-run",
      "--limit",
      "2",
    ])).toEqual({ sourceStableKey: "fixture.spanish.daily", dryRun: true, limit: 2 });
  });

  it("prints only the internal run summary, step states, counts and estimated cost", async () => {
    const output: string[] = [];
    await runAcquireContentCli([
      "--source",
      "fixture.spanish.daily",
      "--dry-run",
      "--limit",
      "1",
    ], {
      repository: dryRunRepository(),
      adapter: new FakeContentSourceAdapter([{
        sourceStableKey: "fixture.spanish.daily",
        cursor: "page-1",
        nextCursor: "page-2",
        estimatedCostMicros: 25,
        items: [{
          externalItemId: "video-1",
          canonicalUrl: "https://example.test/video-1",
          title: "Fixture",
          contentType: "video",
          language: "es",
          publishedAt: null,
          contentHash: null,
          metadata: {},
        }],
      }]),
      write: (line) => output.push(line),
    });

    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0]!)).toEqual({
      runId: expect.any(String),
      status: "succeeded",
      steps: { discovery: "completed", persistence: "skipped" },
      counts: { discovered: 1, inserted: 0, duplicates: 0, conflicts: 0 },
      estimatedCostMicros: 25,
    });
    expect(output[0]).not.toContain("fixture.spanish.daily");
    expect(output[0]).not.toContain("page-2");
  });
});
