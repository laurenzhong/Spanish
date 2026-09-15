import { describe, expect, it } from "vitest";

import { cleanupCandidateArtifacts } from "@/src/modules/content-acquisition";

describe("candidate artifact cleanup", () => {
  it("returns delete-pending when no executor confirms deletion", async () => {
    const result = await cleanupCandidateArtifacts({
      retention: {
        candidate: { id: "candidate-1", status: "processing", lastActivityAt: new Date("2026-01-01"), rejectedAt: null },
        artifacts: [{ id: "artifact-1", kind: "asr-temporary-audio", byteSize: 4, ephemeral: true, processingStatus: "succeeded" }],
        now: new Date("2026-01-02"), largeArtifactThresholdBytes: 100,
      },
      executor: { deleteArtifact: async () => "delete-pending" },
    });
    expect(result.outcomes[0]).toMatchObject({ status: "delete-pending" });
  });

  it("records executor failures instead of claiming deletion", async () => {
    const result = await cleanupCandidateArtifacts({
      retention: {
        candidate: { id: "candidate-1", status: "processing", lastActivityAt: new Date("2026-01-01"), rejectedAt: null },
        artifacts: [{ id: "artifact-1", kind: "asr-temporary-audio", byteSize: 4, ephemeral: true, processingStatus: "failed" }],
        now: new Date("2026-01-02"), largeArtifactThresholdBytes: 100,
      },
      executor: { deleteArtifact: async () => { throw Object.assign(new Error("storage down"), { code: "STORAGE_UNAVAILABLE" }); } },
    });
    expect(result.outcomes[0]).toMatchObject({ status: "failed", errorCode: "STORAGE_UNAVAILABLE" });
  });
});

