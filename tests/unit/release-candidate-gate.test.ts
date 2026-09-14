import { describe, expect, it } from "vitest";
import { evaluateReleaseCandidateGate, releaseCandidateCheckNames } from "@/src/modules/release-candidate";
import { runReleaseCandidateCheck } from "@/scripts/check-release-candidate";

const passingChecks = Object.fromEntries(releaseCandidateCheckNames.map((name) => [name, { status: "passed" as const }]));

describe("release candidate gate", () => {
  it("requires all required checks, no P0/P1 issues and explicit product confirmation", () => {
    expect(evaluateReleaseCandidateGate({ checks: passingChecks, openP0: 0, openP1: 0, productConfirmed: true })).toMatchObject({ eligible: true, reasons: [] });
    const blocked = evaluateReleaseCandidateGate({ checks: { ...passingChecks, e2eDesktop: { status: "blocked" } }, openP0: 1, openP1: 2, productConfirmed: false });
    expect(blocked.eligible).toBe(false);
    expect(blocked.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "required-check-not-passed", check: "e2eDesktop" }),
      expect.objectContaining({ code: "open-p0" }),
      expect.objectContaining({ code: "open-p1" }),
      expect.objectContaining({ code: "product-confirmation-required" }),
    ]));
  });

  it("records iPhone and Flutter as deferred verification without treating them as passed", () => {
    const result = evaluateReleaseCandidateGate({ checks: passingChecks, openP0: 0, openP1: 0, productConfirmed: true });
    expect(result.deferredVerification).toEqual({ iphoneSafari: true, flutter: true });
  });

  it("rejects invalid issue counts", () => {
    expect(() => evaluateReleaseCandidateGate({ checks: passingChecks, openP0: -1, openP1: 0, productConfirmed: true })).toThrow();
  });

  it("reads a report file and emits a stable machine-readable decision", async () => {
    const output: string[] = [];
    await expect(runReleaseCandidateCheck(["--input", "tests/fixtures/release-candidate/passing.json"], (line) => output.push(line))).resolves.toBe(true);
    expect(JSON.parse(output[0]!)).toMatchObject({ status: "eligible", eligible: true, deferredVerification: { iphoneSafari: true, flutter: true } });
    await expect(runReleaseCandidateCheck(["--input", "tests/fixtures/release-candidate/blocked.json"], (line) => output.push(line))).resolves.toBe(false);
    expect(JSON.parse(output[1]!)).toMatchObject({ status: "blocked", eligible: false });
  });
});
