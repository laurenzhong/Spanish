import { describe, expect, it } from "vitest";

import { createReadlangLinksAdapterFromSource, isReadlangAllowlistedUrl } from "@/src/modules/content-acquisition";
import { readlangLinksPolicySchema } from "@/src/modules/content-acquisition";
import policyJson from "@/content/source-policies/readlang-links-v2.json";
import { planDailyArticleRun } from "@/src/modules/content-acquisition/domain/article-publication-policy";
import type { ContentSourceRecord } from "@/src/modules/content-acquisition";

function source(overrides: Partial<ContentSourceRecord> = {}): ContentSourceRecord {
  return {
    id: "00000000-0000-4000-0000-000000000901",
    stableKey: "readlang.links",
    adapterType: "readlang-links",
    sourceKind: "article-site",
    externalSourceId: "https://readlang.com/es/links",
    displayName: "Readlang authorized links",
    language: "es",
    region: "es-ES",
    enabled: true,
    rightsStatus: "verified",
    rightsPolicy: {
      policyVersion: "readlang-links-v2",
      automatedPublication: {
        enabled: false,
        policyVersion: "readlang-links-v2",
        approvedAt: "2026-09-18T00:00:00.000Z",
        dailyLimit: 10,
      },
    },
    cursor: null,
    revision: 1,
    ...overrides,
  };
}

function readlangPolicy() {
  return readlangLinksPolicySchema.parse(policyJson);
}

describe("Readlang source publication stages", () => {
  it("parses the checked-in authorization snapshot at the runtime boundary", () => {
    expect(createReadlangLinksAdapterFromSource(source(), viFetch)).toMatchObject({ key: "readlang-links" });
  });

  it("does not treat a lookalike path as an allowlisted Readlang prefix", () => {
    const policy = readlangPolicy();
    expect(isReadlangAllowlistedUrl("https://readlang.com/library/article", policy)).toBe(true);
    expect(isReadlangAllowlistedUrl("https://readlang.com/library-elsewhere", policy)).toBe(false);
  });

  it("limits external hosts to the exact authorized snapshot URLs", () => {
    const policy = readlangPolicy();
    expect(isReadlangAllowlistedUrl("https://elpais.com/", policy)).toBe(true);
    expect(isReadlangAllowlistedUrl("https://elpais.com/not-in-the-snapshot", policy)).toBe(false);
  });

  it("allows the newly authorized exact Spanish article URLs only", () => {
    const policy = readlangPolicy();
    expect(isReadlangAllowlistedUrl("https://cnnespanol.cnn.com/2026/09/19/mundo/frustracion-ee-uu-huties-medio-oriente-trax", policy)).toBe(true);
    expect(isReadlangAllowlistedUrl("https://www.literatura.us/acs/payaso.html", policy)).toBe(true);
    expect(isReadlangAllowlistedUrl("https://cnnespanol.cnn.com/2026/09/19/mundo/not-authorized", policy)).toBe(false);
    expect(isReadlangAllowlistedUrl("https://www.literatura.us/acs/not-authorized.html", policy)).toBe(false);
  });


  it("allows discover-only and review-only while keeping auto-publish fail closed", () => {
    const readlang = source();
    expect(planDailyArticleRun({ date: "2026-09-18", mode: "discover-only", policyVersion: "readlang-links-v2", dailyLimit: 50, defaultSourceLimit: 10, sources: [readlang] }).sourcePlans).toEqual([{ sourceStableKey: "readlang.links", sourceLimit: 10 }]);
    expect(planDailyArticleRun({ date: "2026-09-18", mode: "review-only", policyVersion: "readlang-links-v2", dailyLimit: 50, defaultSourceLimit: 10, sources: [readlang] }).sourcePlans).toEqual([{ sourceStableKey: "readlang.links", sourceLimit: 10 }]);
    expect(planDailyArticleRun({ date: "2026-09-18", mode: "auto-publish", policyVersion: "readlang-links-v2", dailyLimit: 50, defaultSourceLimit: 10, sources: [readlang] }).sourcePlans).toEqual([]);
  });
});

const viFetch: typeof fetch = async () => new Response(null, { status: 500 });
