import { describe, expect, it } from "vitest";

import { evaluateMediaAsrEligibility } from "@/src/modules/content-acquisition";

const base = {
  contentType: "podcast" as const,
  language: "es",
  sourceEnabled: true,
  rightsStatus: "verified" as const,
  durationMs: 60_000,
  assetBytes: 2_000,
  budgetPolicy: { dailyCostLimitMicros: 1_000, monthlyCostLimitMicros: 5_000, maxCandidateBytes: 10_000, maxDurationSeconds: 120 },
  budgetUsage: { dailyCostMicros: 0, monthlyCostMicros: 0 },
  estimatedCostMicros: 100,
  hasManualTranscript: false,
  hasAutomaticTranscript: false,
};

describe("media ASR eligibility", () => {
  it("prefers reviewed platform transcripts over ASR", () => {
    expect(evaluateMediaAsrEligibility({ ...base, hasManualTranscript: true })).toEqual({ allowed: false, reason: "existing-transcript", transcriptSource: "platform_manual" });
    expect(evaluateMediaAsrEligibility({ ...base, hasAutomaticTranscript: true })).toEqual({ allowed: false, reason: "existing-transcript", transcriptSource: "platform_auto" });
  });

  it("blocks unverified sources and exhausted budgets before any provider call", () => {
    expect(evaluateMediaAsrEligibility({ ...base, rightsStatus: "unknown" })).toMatchObject({ allowed: false, reason: "rights-required" });
    expect(evaluateMediaAsrEligibility({ ...base, budgetUsage: { dailyCostMicros: 1_000, monthlyCostMicros: 1_000 } })).toMatchObject({ allowed: false, reason: "daily-cost" });
  });

  it("allows only Spanish video and podcast candidates", () => {
    expect(evaluateMediaAsrEligibility(base)).toEqual({ allowed: true, transcriptSource: "asr" });
    expect(evaluateMediaAsrEligibility({ ...base, contentType: "article" })).toMatchObject({ allowed: false, reason: "unsupported-content" });
  });
});

