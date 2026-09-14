// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { cleanupCandidateArtifacts } from "@/src/modules/content-acquisition";

describe("candidate artifact cleanup", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("executes due work once and leaves future work untouched", async () => {
    const deleteArtifact = vi.fn(async () => undefined);
    const result = await cleanupCandidateArtifacts([
      { artifactId: "a", dueAt: new Date("2026-09-14T11:00:00.000Z") },
      { artifactId: "a", dueAt: new Date("2026-09-14T11:00:00.000Z") },
      { artifactId: "b", dueAt: new Date("2026-09-15T11:00:00.000Z") },
    ], { deleteArtifact }, now);
    expect(result).toEqual({ attempted: 1, deleted: ["a"], deferred: [] });
    expect(deleteArtifact).toHaveBeenCalledTimes(1);
  });

  it("records failed deletion as deferred instead of claiming success", async () => {
    const recordDeletionFailure = vi.fn(async () => undefined);
    const result = await cleanupCandidateArtifacts([
      { artifactId: "a", dueAt: new Date("2026-09-14T11:00:00.000Z") },
    ], { deleteArtifact: vi.fn(async () => { throw new Error("storage unavailable"); }), recordDeletionFailure }, now);
    expect(result).toEqual({ attempted: 1, deleted: [], deferred: ["a"] });
    expect(recordDeletionFailure).toHaveBeenCalledWith({ artifactId: "a", error: "storage unavailable", occurredAt: now });
  });
});
