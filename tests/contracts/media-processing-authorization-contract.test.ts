// @vitest-environment node

import { describe, expect, it } from "vitest";
import { youtubeRightsPolicySchema } from "@/src/modules/content-acquisition/adapters/youtube/youtube-policy";
import { podcastRightsPolicySchema } from "@/src/modules/content-acquisition/adapters/podcast/podcast-policy";
import { languageReactorRightsPolicySchema } from "@/src/modules/content-acquisition/adapters/language-reactor/language-reactor-adapter";
import { mediaProcessingAuthorizationSchema } from "@/src/modules/media-processing/schemas/processing-authorization";
import { isMediaProcessingAuthorized } from "@/src/modules/media-processing/domain/processing-authorization";

const grant = { version: 1, allowedOperations: ["translate"], audience: "shared-learning", thirdPartyProcessing: true, evidenceUrl: "https://source.example.test/permission", expiresAt: null };
const common = { license: "licensed", attribution: "Test source", licenseEvidence: "https://source.example.test/license", cefr: "A2", topics: ["topic.daily-life"] };
const audio = { allowedAudioHosts: ["source.example.test"], maxEnclosureBytes: 1000 };

describe("explicit processing authorization contract", () => {
  it.each([
    ["YouTube", youtubeRightsPolicySchema, { ...common, contentMode: "official_embed", allowedRegions: ["ES"] }],
    ["podcast", podcastRightsPolicySchema, { ...common, ...audio, contentMode: "enclosure_playback", allowedEpisodeHosts: ["source.example.test"] }],
    ["Language Reactor", languageReactorRightsPolicySchema, { ...common, ...audio, provider: "language-reactor", directoryUrl: "https://www.languagereactor.com/c/es/yt/test", allowedAudioMimeTypes: ["audio/mpeg"] }],
  ] as const)("keeps legacy %s discovery valid and accepts a strict optional processing grant", (_name, schema, policy) => {
    expect(schema.parse(policy)).not.toHaveProperty("mediaProcessing");
    expect(schema.parse({ ...policy, mediaProcessing: grant })).toHaveProperty("mediaProcessing", grant);
    expect(schema.safeParse({ ...policy, mediaProcessing: { ...grant, audience: "everyone" } }).success).toBe(false);
  });

  it.each([
    {}, { ...grant, version: 2 }, { ...grant, expiresAt: undefined },
    { ...grant, thirdPartyProcessing: undefined }, { ...grant, evidenceUrl: "https://user:secret@source.example.test/permission" },
    { ...grant, allowedOperations: [] }, { ...grant, allowedOperations: ["translate", "translate"] },
    { ...grant, allowedOperations: ["publish"] }, { ...grant, unknown: true },
  ])("rejects incomplete or ambiguous grants: %j", (value) => {
    expect(mediaProcessingAuthorizationSchema.safeParse(value).success).toBe(false);
  });

  it("supports explicit private processing without treating it as library authorization", () => {
    const authorization = mediaProcessingAuthorizationSchema.parse({ ...grant, audience: "owner-private" });
    const context = { sourceEnabled: true, rightsStatus: "verified", authorization, operations: ["translate"] as const, now: new Date("2026-10-16T00:00:00.000Z") };
    expect(isMediaProcessingAuthorized({ ...context, audience: "owner-private" })).toBe(true);
    expect(isMediaProcessingAuthorized({ ...context, audience: "shared-learning" })).toBe(false);
    expect(isMediaProcessingAuthorized({ ...context, audience: "owner-private", now: new Date(NaN) })).toBe(false);
  });
});
