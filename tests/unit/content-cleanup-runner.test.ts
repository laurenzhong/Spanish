import { describe, expect, it, vi } from "vitest";
import { runContentCleanup } from "@/src/modules/content-acquisition";
import type { ContentCandidateRecord } from "@/src/modules/content-acquisition";

const candidate = (overrides: Partial<ContentCandidateRecord> = {}): ContentCandidateRecord => ({
  id: "candidate-1", sourceId: "source-1", externalItemId: "item-1", normalizedUrl: "https://example.test/1",
  title: "Uno", language: "es", metadata: {}, publishedAt: null, contentHash: null, contentType: "article",
  rightsStatus: "verified", status: "rejected", revision: 1, generationId: "generation-1",
  lastActivityAt: new Date("2026-08-01T00:00:00Z"), rejectedAt: new Date("2026-08-01T00:00:00Z"),
  publicationStatus: "draft", publicationRef: null, publishedCandidateRevision: null, publishedContentHash: null,
  publishedAtInternal: null, archivedAt: null, ...overrides,
});

describe("content cleanup runner", () => {
  it("deletes due artifacts and purges expired unpublished candidates", async () => {
    const repository = {
      listCandidatesForCleanup: vi.fn(async () => [candidate()]),
      listCandidateArtifactsForCleanup: vi.fn(async () => [{ id: "artifact-1", kind: "asr-temporary-audio", byteSize: 2_000_000, ephemeral: true, processingStatus: "succeeded" as const }]),
      deleteCandidateArtifact: vi.fn(async () => undefined),
      purgeCandidate: vi.fn(async () => undefined),
    };
    const result = await runContentCleanup({ repository, now: new Date("2026-09-01T00:00:00Z"), largeArtifactThresholdBytes: 1_000_000, limit: 10, dryRun: false });
    expect(result).toMatchObject({ candidates: 1, attemptedArtifacts: 1, deletedArtifacts: 1, purgedCandidates: 1 });
    expect(repository.deleteCandidateArtifact).toHaveBeenCalledWith("artifact-1");
    expect(repository.purgeCandidate).toHaveBeenCalledWith("candidate-1");
  });

  it("keeps failed deletes retryable and dry-runs free of writes", async () => {
    const recordFailure = vi.fn(async () => undefined);
    const repository = {
      listCandidatesForCleanup: vi.fn(async () => [candidate({ id: "candidate-2" })]),
      listCandidateArtifactsForCleanup: vi.fn(async () => [{ id: "artifact-2", kind: "asr-temporary-audio", byteSize: 1, ephemeral: true, processingStatus: "failed" as const }]),
      deleteCandidateArtifact: vi.fn(async () => { throw new Error("storage unavailable"); }),
      purgeCandidate: vi.fn(async () => undefined),
    };
    const result = await runContentCleanup({ repository, now: new Date("2026-09-01T00:00:00Z"), largeArtifactThresholdBytes: 1_000_000, limit: 10, dryRun: false, recordFailure });
    expect(result.deferredArtifacts).toBe(1);
    expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ artifactId: "artifact-2" }));
    await runContentCleanup({ repository, now: new Date("2026-09-01T00:00:00Z"), largeArtifactThresholdBytes: 1_000_000, limit: 10, dryRun: true });
    expect(repository.deleteCandidateArtifact).toHaveBeenCalledTimes(1);
  });
});
