import { describe, expect, it } from "vitest";

import { evaluateMediaAsrEligibility } from "@/src/modules/media-processing";

const policy = { maxDurationMs: 30 * 60 * 1_000, maxAssetBytes: 50_000_000, maxEstimatedCostMicros: 2_000_000, minimumConfidence: 0.72 };
const base = { sourceEnabled: true, rightsStatus: "verified" as const, language: "es", durationMs: 600_000, assetBytes: 1_000_000, estimatedCostMicros: 100_000, captionStatus: "unavailable" as const, segmentCount: 0 };

describe("media ASR eligibility", () => {
  it("prefers any existing reviewed captions over ASR", () => {
    expect(evaluateMediaAsrEligibility({ ...base, captionStatus: "platform_auto", segmentCount: 3 }, policy)).toEqual({ allowed: false, reason: "captions-present" });
  });

  it("requires verified rights and Spanish source before acquiring audio", () => {
    expect(evaluateMediaAsrEligibility({ ...base, rightsStatus: "unknown" }, policy)).toEqual({ allowed: false, reason: "rights-required" });
    expect(evaluateMediaAsrEligibility({ ...base, language: "en" }, policy)).toEqual({ allowed: false, reason: "unsupported-language" });
  });

  it("blocks duration, size, and estimated cost over hard limits", () => {
    expect(evaluateMediaAsrEligibility({ ...base, durationMs: policy.maxDurationMs + 1 }, policy)).toEqual({ allowed: false, reason: "duration" });
    expect(evaluateMediaAsrEligibility({ ...base, assetBytes: policy.maxAssetBytes + 1 }, policy)).toEqual({ allowed: false, reason: "asset-size" });
    expect(evaluateMediaAsrEligibility({ ...base, estimatedCostMicros: policy.maxEstimatedCostMicros + 1 }, policy)).toEqual({ allowed: false, reason: "budget" });
  });

  it("allows only eligible captionless media", () => {
    expect(evaluateMediaAsrEligibility(base, policy)).toEqual({ allowed: true, reason: "asr-required" });
  });
});
