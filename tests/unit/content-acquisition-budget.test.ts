import { describe, expect, it } from "vitest";

import {
  evaluateProcessingBudget,
  evaluateSourcePolicy,
} from "@/src/modules/content-acquisition";

const policy = {
  dailyCostLimitMicros: 1_000,
  monthlyCostLimitMicros: 10_000,
  maxCandidateBytes: 5_000_000,
  maxDurationSeconds: 1_200,
};

describe("content acquisition rights and budget gates", () => {
  it("allows metadata but blocks large acquisition and processing while rights are unknown", () => {
    expect(
      evaluateSourcePolicy({ enabled: true, rightsStatus: "unknown", operation: "read-metadata" }),
    ).toEqual({ allowed: true });
    expect(
      evaluateSourcePolicy({ enabled: true, rightsStatus: "unknown", operation: "acquire-large-asset" }),
    ).toEqual({ allowed: false, reason: "rights-required" });
    expect(
      evaluateSourcePolicy({ enabled: true, rightsStatus: "unknown", operation: "process" }),
    ).toEqual({ allowed: false, reason: "rights-required" });
  });

  it.each(["restricted", "revoked"] as const)(
    "blocks processing and publication for %s sources",
    (rightsStatus) => {
      for (const operation of ["process", "publish"] as const) {
        expect(evaluateSourcePolicy({ enabled: true, rightsStatus, operation }).allowed).toBe(false);
      }
    },
  );

  it("blocks disabled sources before evaluating rights", () => {
    expect(
      evaluateSourcePolicy({ enabled: false, rightsStatus: "verified", operation: "read-metadata" }),
    ).toEqual({ allowed: false, reason: "source-disabled" });
  });

  it("allows a request exactly on every configured limit", () => {
    expect(
      evaluateProcessingBudget(policy, { dailyCostMicros: 500, monthlyCostMicros: 9_500 }, {
        estimatedCostMicros: 500,
        assetBytes: 5_000_000,
        durationSeconds: 1_200,
      }),
    ).toEqual({ allowed: true });
  });

  it.each([
    ["daily-cost", { estimatedCostMicros: 501, assetBytes: 1, durationSeconds: 1 }],
    ["monthly-cost", { estimatedCostMicros: 501, assetBytes: 1, durationSeconds: 1 }],
    ["asset-size", { estimatedCostMicros: 0, assetBytes: 5_000_001, durationSeconds: 1 }],
    ["duration", { estimatedCostMicros: 0, assetBytes: 1, durationSeconds: 1_201 }],
  ] as const)("blocks the %s limit", (reason, request) => {
    const usage = reason === "monthly-cost"
      ? { dailyCostMicros: 0, monthlyCostMicros: 9_500 }
      : { dailyCostMicros: 500, monthlyCostMicros: 0 };
    expect(evaluateProcessingBudget(policy, usage, request)).toEqual({ allowed: false, reason });
  });
});
