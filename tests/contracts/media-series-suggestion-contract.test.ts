// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { proposeMediaSeriesSuggestion } from "@/src/modules/media/application/propose-media-series-suggestion";
import { mediaSeriesSuggestionSchema } from "@/src/modules/media/schemas/media-series-suggestion";

function validators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const directory = path.join(process.cwd(), "contracts/schemas/v1");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(directory, file), "utf8")));
  }
  const candidate = JSON.parse(readFileSync(path.join(directory, "content-workflow-candidate.schema.json"), "utf8"));
  return { suggestion: ajv.getSchema("media-series-suggestion.schema.json")!, metadata: ajv.compile(candidate.properties.metadata) };
}
const { suggestion: validate, metadata: validateMetadata } = validators();
const input = { sourceStableKey: "source.fixture", mediaStableKey: "podcast.fixture.1", kind: "podcast", basis: "podcast_feed",
  externalSeriesId: "https://publisher.example.test/feed.xml", title: "Historias", sourceUrl: "https://publisher.example.test/feed.xml", seasonNumber: null, episodeNumber: null };
const output = proposeMediaSeriesSuggestion(input)!;

describe("internal media series suggestion contract", () => {
  it("accepts actual media application proposals for each supported basis without directory authority", () => {
    for (const value of [input, { ...input, kind: "video", basis: "playlist", externalSeriesId: "PL-fixture", metadataConflict: true },
      { ...input, basis: "structured_programme", externalSeriesId: "itunes:123", seasonNumber: 0, episodeNumber: 0 }]) {
      const proposal = proposeMediaSeriesSuggestion(value);
      expect(proposal).not.toBeNull();
      expect(validate(proposal), JSON.stringify(validate.errors)).toBe(true);
      expect(proposal?.status).toBe("unconfirmed");
      expect(proposal).not.toHaveProperty("seriesKey");
      expect(proposal).not.toHaveProperty("position");
    }
  });

  it("aligns structural bounds, honest null/zero numbers, warning uniqueness and basis-kind checks with Zod", () => {
    for (const value of [output, { ...output, seasonNumber: 0, episodeNumber: 2147483647 }, { ...output, warnings: ["feed_may_be_mixed", "metadata_conflict"] }]) {
      expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
      expect(mediaSeriesSuggestionSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [
      { ...output, status: "confirmed" }, { ...output, kind: "video" }, { ...output, basis: "title_similarity" },
      { ...output, suggestionKey: "a".repeat(63) }, { ...output, mediaStableKey: "../media" },
      { ...output, title: "x".repeat(201) }, { ...output, externalSeriesId: "x".repeat(501) },
      { ...output, seasonNumber: -1 }, { ...output, episodeNumber: 2147483648 }, { ...output, episodeNumber: 1.5 },
      { ...output, warnings: ["approved"] }, { ...output, warnings: ["metadata_conflict", "metadata_conflict"] },
      { ...output, warnings: ["feed_may_be_mixed", "playlist_may_be_curated", "metadata_conflict"] },
      { ...output, seriesKey: "series.guessed" }, { ...output, position: 1 },
    ]) {
      expect(validate(value), JSON.stringify(value)).toBe(false);
      expect(mediaSeriesSuggestionSchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it("requires every serialized output field while keeping legacy candidate metadata compatible", () => {
    for (const key of Object.keys(output)) {
      const partial = { ...output } as Record<string, unknown>;
      delete partial[key];
      expect(validate(partial), key).toBe(false);
    }
    for (const metadata of [{}, { podcastDraft: { contentHash: "a".repeat(64) } }, { podcastDraft: {}, mediaSeriesSuggestions: [] },
      { podcastDraft: {}, mediaSeriesSuggestions: [output] }]) expect(validateMetadata(metadata), JSON.stringify(validateMetadata.errors)).toBe(true);
    expect(validateMetadata({ mediaSeriesSuggestions: [{ ...output, status: "confirmed" }] })).toBe(false);
    expect(validateMetadata({ mediaSeriesSuggestions: output })).toBe(false);
  });

  it("keeps URL and audit-text semantics at the runtime application boundary", () => {
    for (const sourceUrl of ["https://user:secret@publisher.example.test/feed.xml", "https://127.0.0.1/feed.xml",
      "https://publisher.example.test/feed.xml?%74oken=secret", "https://publisher.example.test/feed.xml#access_token=secret"]) {
      expect(proposeMediaSeriesSuggestion({ ...input, sourceUrl })).toBeNull();
      expect(mediaSeriesSuggestionSchema.safeParse({ ...output, sourceUrl }).success).toBe(false);
    }
    expect(validate({ ...output, sourceUrl: "http://publisher.example.test/feed.xml" })).toBe(false);
    const normalized = proposeMediaSeriesSuggestion({ ...input, sourceUrl: "https://PUBLISHER.example.test:443/feed.xml" });
    expect(normalized?.sourceUrl).toBe(input.sourceUrl);
    expect(validate(normalized), JSON.stringify(validate.errors)).toBe(true);
  });
});
