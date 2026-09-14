import { describe, expect, it, vi } from "vitest";
import { formatPipelineObservation, recordPipelineObservationSafely, sanitizePipelineObservation } from "@/src/modules/content-acquisition";

describe("content pipeline observability", () => {
  it("redacts unsafe identifiers and preserves only bounded counters", () => {
    const value = sanitizePipelineObservation({ runId: "https://secret", sourceStableKey: "bad source", step: "discover", status: "succeeded", durationMs: -2, counts: { inserted: 2, "bad key!": 4, negative: -1 }, estimatedCostMicros: 7 });
    expect(value).toEqual({ runId: "redacted-run", step: "discover", status: "succeeded", durationMs: 0, counts: { inserted: 2 }, estimatedCostMicros: 7 });
    expect(formatPipelineObservation(value)).not.toContain("https://");
  });

  it("does not let an observer failure fail the pipeline", async () => {
    const observer = { record: vi.fn(async () => { throw new Error("diagnostic down"); }) };
    await expect(recordPipelineObservationSafely(observer, { runId: "run-12345678", step: "report", status: "failed", durationMs: 2 })).resolves.toBeUndefined();
  });
});
