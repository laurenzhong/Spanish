import { describe, expect, it } from "vitest";

import { createReadlangLinksSourceInput } from "@/scripts/register-readlang-links-source";
import policyJson from "@/content/source-policies/readlang-links-v6.json";

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
      policyVersion: "readlang-links-v6",
      dailyLimit: 50,
    });
    expect(source.rightsPolicy.maxArticleBytes).toBe(5_000_000);
  });

  it("places all 100 authorized Readlang library URLs before the other snapshot URLs", () => {
    const urls = policyJson.allowlist.urls;
    const libraryUrls = urls.filter((url) => new URL(url).pathname.startsWith("/library/"));
    expect(libraryUrls).toHaveLength(100);
    expect(urls.slice(0, libraryUrls.length)).toEqual(libraryUrls);
    expect(urls).toHaveLength(164);
  });
});
