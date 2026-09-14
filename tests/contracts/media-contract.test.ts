// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const directory = path.join(process.cwd(), "contracts", "schemas", "v1");
  for (const file of readdirSync(directory).filter((candidate) => candidate.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(directory, file), "utf8")));
  }
  return ajv.getSchema(name)!;
}

const item = {
  id: "media.fixture.cafe@1", stableKey: "media.fixture.cafe", version: 1, kind: "video",
  title: "Una charla", summary: "Resumen", sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2",
  topics: ["topic.daily-life"], durationMs: 60_000, publishedAt: null, curatedAt: "2026-09-13T00:00:00.000Z",
  contentHash: "a".repeat(64), artwork: null, progress: null,
};

describe("media v1 contracts", () => {
  it("validates bounded list and playback responses without internal locators", () => {
    const list = validator("media-list-response.schema.json");
    expect(list({ apiVersion: "v1", data: { items: [item] }, page: { nextCursor: null, hasMore: false } }), JSON.stringify(list.errors)).toBe(true);
    expect(list({ apiVersion: "v1", data: { items: [{ ...item, internalLocator: "private/path" }] }, page: { nextCursor: null, hasMore: false } })).toBe(false);
    const playback = validator("media-playback-response.schema.json");
    expect(playback({ apiVersion: "v1", data: { media: item, asset: { kind: "official_embed", url: "https://player.example.test/embed/1", expiresAt: null }, segments: [] } }), JSON.stringify(playback.errors)).toBe(true);
  });

  it("validates revisioned progress writes", () => {
    const request = validator("media-progress-request.schema.json");
    expect(request({ version: 1, expectedRevision: 0, lastPositionMs: 10_000, lastSegmentIndex: 2, status: "in_progress" })).toBe(true);
    expect(request({ version: 1, expectedRevision: -1, lastPositionMs: 10_000, lastSegmentIndex: null, status: "in_progress" })).toBe(false);
    const response = validator("media-progress-response.schema.json");
    expect(response({ apiVersion: "v1", data: { progress: { lastPositionMs: 10_000, lastSegmentIndex: 2, status: "in_progress", revision: 1 } } }), JSON.stringify(response.errors)).toBe(true);
  });

  it("validates the published media detail response", () => {
    const detail = validator("media-detail-response.schema.json");
    expect(detail({ apiVersion: "v1", data: item }), JSON.stringify(detail.errors)).toBe(true);
  });

  it("registers all media routes in OpenAPI", () => {
    const openapi = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "openapi", "v1", "openapi.json"), "utf8"));
    for (const route of ["/media", "/media/{stableKey}", "/media/{stableKey}/playback", "/media/{stableKey}/progress"]) {
      expect(openapi.paths[route]).toBeDefined();
    }
    expect(openapi.paths["/media/{stableKey}"].get.responses["200"].content["application/json"].schema.$ref).toContain("media-detail-response");
    expect(openapi.paths["/media/{stableKey}/progress"].put.responses["200"].content["application/json"].schema.$ref).toContain("media-progress-response");
  });
});
