import { describe, expect, it } from "vitest";

import { createReadlangLinksSourceInput } from "@/scripts/register-readlang-links-source";

describe("Readlang links source registration", () => {
  it("registers the owner-authorized exact URL policy with staged auto-publication enabled", () => {
    const source = createReadlangLinksSourceInput();
    expect(source).toMatchObject({
      stableKey: "readlang.links.es",
      adapterType: "readlang-links",
      sourceKind: "article-site",
      externalSourceId: "https://readlang.com/es/links",
      enabled: true,
      rightsStatus: "verified",
    });
    expect(source.rightsPolicy.automatedPublication).toMatchObject({
      enabled: true,
      policyVersion: "readlang-links-v5",
      dailyLimit: 50,
    });
    expect(source.rightsPolicy.maxArticleBytes).toBe(5_000_000);
  });
});
