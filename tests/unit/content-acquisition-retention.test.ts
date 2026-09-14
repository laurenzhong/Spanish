import { describe, expect, it } from "vitest";

import { planCandidateCleanup } from "@/src/modules/content-acquisition";

const now = new Date("2026-09-13T00:00:00.000Z");

describe("content acquisition retention", () => {
  it("plans unpublished candidate cleanup thirty days after last activity", () => {
    expect(
      planCandidateCleanup({
        candidate: {
          id: "candidate-1",
          status: "review_ready",
          lastActivityAt: new Date("2026-09-01T00:00:00.000Z"),
          rejectedAt: null,
        },
        artifacts: [],
        now,
        largeArtifactThresholdBytes: 1_000_000,
      }),
    ).toContainEqual({
      kind: "purge-candidate",
      targetId: "candidate-1",
      dueAt: new Date("2026-10-01T00:00:00.000Z"),
      reason: "unpublished-retention-expired",
    });
  });

  it("plans rejected large artifacts for deletion after seven days", () => {
    expect(
      planCandidateCleanup({
        candidate: {
          id: "candidate-2",
          status: "rejected",
          lastActivityAt: new Date("2026-09-01T00:00:00.000Z"),
          rejectedAt: new Date("2026-09-10T12:00:00.000Z"),
        },
        artifacts: [{
          id: "artifact-large",
          kind: "downloaded-media",
          byteSize: 2_000_000,
          ephemeral: false,
          processingStatus: "succeeded",
        }],
        now,
        largeArtifactThresholdBytes: 1_000_000,
      }),
    ).toContainEqual({
      kind: "delete-artifact",
      targetId: "artifact-large",
      dueAt: new Date("2026-09-17T12:00:00.000Z"),
      reason: "rejected-large-artifact",
    });
  });

  it.each(["succeeded", "failed", "cancelled", "timed_out"] as const)(
    "deletes ephemeral ASR audio immediately after %s",
    (processingStatus) => {
      expect(
        planCandidateCleanup({
          candidate: {
            id: "candidate-3",
            status: "processing",
            lastActivityAt: now,
            rejectedAt: null,
          },
          artifacts: [{
            id: "asr-audio",
            kind: "asr-temporary-audio",
            byteSize: 500,
            ephemeral: true,
            processingStatus,
          }],
          now,
          largeArtifactThresholdBytes: 1_000_000,
        }),
      ).toContainEqual({
        kind: "delete-artifact",
        targetId: "asr-audio",
        dueAt: now,
        reason: "ephemeral-processing-terminal",
      });
    },
  );
});
