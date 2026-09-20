import { describe, expect, it } from "vitest";

import { parseProviderJson, parseProviderJsonCandidates } from "@/src/modules/content-acquisition/providers/parse-provider-json";

describe("provider JSON parsing", () => {
  it("accepts fenced JSON and short model preambles without loosening the caller schema", () => {
    expect(parseProviderJson("Here is the result:\n```json\n{\"decision\":\"approved\",\"notes\":\"ok\"}\n```"))
      .toEqual({ decision: "approved", notes: "ok" });
  });

  it("returns null for incomplete or non-object output", () => {
    expect(parseProviderJson("not JSON")) .toBeNull();
    expect(parseProviderJson('{"decision":"approved"')).toBeNull();
  });

  it("returns all bounded objects so callers can skip a preamble object", () => {
    expect(parseProviderJsonCandidates('preamble {"kind":"meta"} result {"decision":"approved"}')).toEqual([
      { kind: "meta" },
      { decision: "approved" },
    ]);
  });
});
