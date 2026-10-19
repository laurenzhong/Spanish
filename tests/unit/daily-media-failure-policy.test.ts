import { describe, expect, it } from "vitest";

import {
  dailyMediaRunFails,
  type DailyMediaPipelineFailure,
} from "@/src/modules/content-acquisition/application/run-daily-media-pipeline";

function failure(overrides: Partial<DailyMediaPipelineFailure> = {}): DailyMediaPipelineFailure {
  return { scope: "candidate", code: "MEDIA_AUDIO_REQUEST_FAILED", ...overrides };
}

describe("daily media run exit policy", () => {
  it("does not fail for review outcomes or candidate-scoped failures", () => {
    // Mirror of the 2026-10-19 run 39225780831: two podcasts published, four
    // candidates asked for changes, one rejected, six candidate failures and
    // no source-scoped failure. This used to exit 1 and email the owner.
    const failures = Array.from({ length: 6 }, () => failure());
    expect(dailyMediaRunFails({
      mode: "auto-publish",
      failures,
      reviewed: 10,
      publishedByType: { video: 0, podcast: 2 },
    })).toBe(false);
  });

  it("fails an auto-publish run when a source-scoped failure occurred", () => {
    const failures = [
      failure(),
      failure({ scope: "source", sourceStableKey: "language-reactor.podcast-mix-es", code: "MEDIA_SOURCE_TIMEOUT" }),
    ];
    expect(dailyMediaRunFails({
      mode: "auto-publish",
      failures,
      reviewed: 10,
      publishedByType: { video: 0, podcast: 2 },
    })).toBe(true);
  });

  it("fails when candidates were reviewed but nothing was published for the day", () => {
    expect(dailyMediaRunFails({
      mode: "auto-publish",
      failures: [failure()],
      reviewed: 6,
      publishedByType: { video: 0, podcast: 0 },
    })).toBe(true);
  });

  it("does not fail a quiet run that reviewed nothing and published nothing", () => {
    expect(dailyMediaRunFails({
      mode: "auto-publish",
      failures: [],
      reviewed: 0,
      publishedByType: { video: 0, podcast: 0 },
    })).toBe(false);
  });

  it("never fails a mode that does not publish", () => {
    const failures = [failure({ scope: "source", code: "MEDIA_SOURCE_TIMEOUT" })];
    for (const mode of ["disabled", "discover-only", "review-only"] as const) {
      expect(dailyMediaRunFails({
        mode,
        failures,
        reviewed: 5,
        publishedByType: { video: 0, podcast: 0 },
      })).toBe(false);
    }
  });

  it("passes a clean auto-publish run", () => {
    expect(dailyMediaRunFails({
      mode: "auto-publish",
      failures: [],
      reviewed: 3,
      publishedByType: { video: 1, podcast: 2 },
    })).toBe(false);
  });
});
