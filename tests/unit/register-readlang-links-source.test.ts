import { describe, expect, it } from "vitest";

import { createReadlangLinksSourceInput } from "@/scripts/register-readlang-links-source";

describe("Readlang links source registration", () => {
  it("registers the committed exact allowlist policy without enabling auto-publication", () => {
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
      enabled: false,
      policyVersion: "readlang-links-v2",
      dailyLimit: 10,
    });
    expect(source.rightsPolicy.maxArticleBytes).toBe(5_000_000);
  });
});
