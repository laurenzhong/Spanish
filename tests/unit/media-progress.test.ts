// @vitest-environment node

import { describe, expect, it } from "vitest";

import { MediaProgressConflictError, nextMediaProgress } from "@/src/modules/media";

describe("media progress", () => {
  it("creates, advances and idempotently replays a versioned position", () => {
    const created = nextMediaProgress(null, { expectedRevision: 0, lastPositionMs: 4_200, lastSegmentIndex: 1, status: "in_progress" }, 60_000);
    expect(created).toEqual({ lastPositionMs: 4_200, lastSegmentIndex: 1, status: "in_progress", revision: 1 });
    const advanced = nextMediaProgress(created, { expectedRevision: 1, lastPositionMs: 8_400, lastSegmentIndex: 2, status: "in_progress" }, 60_000);
    expect(advanced.revision).toBe(2);
    expect(nextMediaProgress(advanced, { expectedRevision: 1, lastPositionMs: 8_400, lastSegmentIndex: 2, status: "in_progress" }, 60_000)).toEqual(advanced);
  });

  it("rejects stale revisions and impossible positions", () => {
    const current = { lastPositionMs: 4_200, lastSegmentIndex: 1, status: "in_progress" as const, revision: 3 };
    expect(() => nextMediaProgress(current, { ...current, expectedRevision: 2, lastPositionMs: 5_000 }, 60_000)).toThrow(MediaProgressConflictError);
    expect(() => nextMediaProgress(current, { ...current, expectedRevision: 3, lastPositionMs: 60_001 }, 60_000)).toThrow("MEDIA_PROGRESS_INVALID");
  });
});
