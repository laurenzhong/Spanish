import { describe, expect, it } from "vitest";

import {
  normalizeCandidateUrl,
  resolveCandidateIdentity,
  type CandidateIdentity,
} from "@/src/modules/content-acquisition";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);

function identity(overrides: Partial<CandidateIdentity> = {}): CandidateIdentity {
  return {
    candidateId: "candidate-1",
    sourceId: "source-1",
    externalItemId: "item-1",
    normalizedUrl: "https://example.test/watch?a=1&b=2",
    contentHash: hashA,
    ...overrides,
  };
}

describe("content acquisition candidate identity", () => {
  it("normalizes tracking parameters, fragments, ports, query order and trailing slashes", () => {
    expect(
      normalizeCandidateUrl(
        "HTTPS://Example.TEST:443/watch/?b=2&utm_source=newsletter&a=1#transcript",
      ),
    ).toBe("https://example.test/watch?a=1&b=2");
  });

  it.each([
    ["source identity", identity()],
    ["canonical URL", identity({ sourceId: "source-2", externalItemId: "other" })],
    ["content hash", identity({ normalizedUrl: "https://other.test/item" })],
  ])("deduplicates by %s", (_label, existing) => {
    expect(resolveCandidateIdentity([existing], identity())).toMatchObject({
      kind: "duplicate",
      candidateId: "candidate-1",
    });
  });

  it("reports a conflict when a stable source key or URL points at different content", () => {
    expect(
      resolveCandidateIdentity([identity({ contentHash: hashB })], identity()),
    ).toMatchObject({ kind: "conflict", candidateId: "candidate-1" });
  });

  it("returns new when all three identity layers are distinct", () => {
    expect(
      resolveCandidateIdentity(
        [identity()],
        identity({
          candidateId: "candidate-2",
          sourceId: "source-2",
          externalItemId: "item-2",
          normalizedUrl: "https://example.test/other",
          contentHash: hashB,
        }),
      ),
    ).toEqual({ kind: "new" });
  });
});
