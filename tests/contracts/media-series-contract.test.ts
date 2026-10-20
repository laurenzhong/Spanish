// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { saveMediaSeriesCommandSchema, mediaSeriesEpisodesQuerySchema } from "@/src/modules/media/schemas/media-series";
import { API_ERROR_CODES, defaultRetryable } from "@/src/shared/contracts/v1/api-contract";

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const directory = path.join(process.cwd(), "contracts", "schemas", "v1");
  for (const file of readdirSync(directory).filter((entry) => entry.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(directory, file), "utf8")));
  }
  return ajv.getSchema(`${name}.schema.json`)!;
}
const series = { seriesKey: "series.fixture", title: "Programa", summary: "Descripción", kind: "video", orderMode: "ordered", status: "active", revision: 1 };
const view = { ...series, episodeCount: 2 };
const summary = { seriesKey: series.seriesKey, title: series.title, kind: series.kind, orderMode: series.orderMode, revision: 1, seasonNumber: null, episodeNumber: null, episodeLabel: null };
const item = {
  id: "media.fixture.cafe@1", stableKey: "media.fixture.cafe", version: 1, kind: "video", title: "Una charla", summary: "Resumen",
  sourceName: "Canal", language: "es", region: "es-ES", cefr: "A2", topics: [], durationMs: 60_000, publishedAt: null,
  curatedAt: "2026-09-13T00:00:00.000Z", contentHash: "a".repeat(64), progress: null,
};
const command = {
  idempotencyKey: "fixture-import-1", expectedRevision: 0, title: "Programa", summary: "", kind: "video", orderMode: "ordered", status: "active",
  reason: "Verified catalogue", evidence: ["https://example.test/programme"], members: [{ stableKey: item.stableKey, position: 1,
    seasonNumber: null, episodeNumber: null, episodeLabel: null, evidence: ["https://example.test/episode"] }],
  removeStableKeys: [], fromSeriesRevisions: {},
};

describe("media series v1 contracts", () => {
  it("keeps old media cards compatible and accepts only public series summaries", () => {
    const validate = validator("media-item");
    expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...item, series: null })).toBe(true);
    expect(validate({ ...item, series: summary }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...item, series: { ...summary, internalLocator: "private/path" } })).toBe(false);
    expect(validate({ ...item, series: { ...summary, seasonNumber: 0, episodeNumber: 0 } })).toBe(true);
    expect(validate({ ...item, series: { ...summary, episodeNumber: -1 } })).toBe(false);
  });

  it("validates visible counts, bounded pages, nullable adjacent items and six recommendations", () => {
    const detail = validator("media-series-response");
    expect(detail({ apiVersion: "v1", data: view }), JSON.stringify(detail.errors)).toBe(true);
    expect(detail({ apiVersion: "v1", data: { ...view, episodeCount: -1 } })).toBe(false);
    const episodes = validator("media-series-episodes-response");
    const page = { series: view, items: [{ ...item, series: summary }], anchor: { current: item, previous: null, next: item }, nextCursor: null, hasMore: false };
    expect(episodes({ apiVersion: "v1", data: page }), JSON.stringify(episodes.errors)).toBe(true);
    expect(episodes({ apiVersion: "v1", data: { ...page, items: Array(51).fill(item) } })).toBe(false);
    expect(episodes({ apiVersion: "v1", data: { ...page, anchor: { ...page.anchor, previous: { ...item, userId: "other-user" } } } })).toBe(false);
    const recommended = validator("media-series-recommendations-response");
    expect(recommended({ apiVersion: "v1", data: { series: null, items: [] } })).toBe(true);
    expect(recommended({ apiVersion: "v1", data: { series: view, items: Array(6).fill(item) } })).toBe(true);
    expect(recommended({ apiVersion: "v1", data: { series: view, items: Array(7).fill(item) } })).toBe(false);
  });

  it("keeps JSON and Zod bounds aligned for write commands and cursor queries", () => {
    const save = validator("media-series-save-request");
    for (const value of [command, { ...command, expectedRevision: 10, fromSeriesRevisions: { "series.other": 2 } }]) {
      expect(save(value), JSON.stringify(save.errors)).toBe(true);
      expect(saveMediaSeriesCommandSchema.safeParse(value).success).toBe(true);
    }
    for (const value of [{ ...command, expectedRevision: -1 }, { ...command, members: Array(501).fill(command.members[0]) }, { ...command, userId: "other-user" }, { ...command, fromSeriesRevisions: { "series.other": 0 } }]) {
      expect(save(value)).toBe(false);
      expect(saveMediaSeriesCommandSchema.safeParse(value).success).toBe(false);
    }
    const query = validator("media-series-episodes-query");
    for (const value of [{ pageSize: 50 }, { anchorMediaKey: item.stableKey }, { cursor: "opaque" }]) {
      expect(query(value), JSON.stringify(query.errors)).toBe(true);
      expect(mediaSeriesEpisodesQuerySchema.safeParse(value).success).toBe(true);
    }
    for (const value of [{ pageSize: 51 }, { cursor: "opaque", anchorMediaKey: item.stableKey }, { userId: "other-user" }]) {
      expect(query(value)).toBe(false);
      expect(mediaSeriesEpisodesQuerySchema.safeParse(value).success).toBe(false);
    }
    const saved = validator("media-series-save-response");
    expect(saved({ apiVersion: "v1", data: series })).toBe(true);
    expect(saved({ apiVersion: "v1", data: view })).toBe(false);
  });

  it("registers authenticated operations, schemas, query bounds and conflict semantics", () => {
    const openapi = JSON.parse(readFileSync(path.join(process.cwd(), "contracts/openapi/v1/openapi.json"), "utf8"));
    for (const [route, method, schema] of [
      ["/media-series/{seriesKey}", "get", "media-series-response"],
      ["/media-series/{seriesKey}/episodes", "get", "media-series-episodes-response"],
      ["/media/{stableKey}/series-recommendations", "get", "media-series-recommendations-response"],
      ["/internal/content-workflow/media-series/{seriesKey}", "put", "media-series-save-response"],
    ]) {
      const operation = openapi.paths[route][method];
      expect(operation.security).toContainEqual({ bearerAuth: [] });
      expect(operation.responses[200].content["application/json"].schema.$ref).toContain(schema);
      expect(operation.responses[200].headers["Cache-Control"].schema.const).toBe("private, no-store");
      expect(operation.responses[401]).toBeDefined();
      expect(operation.responses[503]).toBeDefined();
    }
    const write = openapi.paths["/internal/content-workflow/media-series/{seriesKey}"].put;
    expect(write.responses[403]).toBeDefined();
    expect(write.responses[409]).toBeDefined();
    expect(write.requestBody.content["application/json"].schema.$ref).toContain("media-series-save-request");
    const apiError = validator("https://spanish.local/contracts/v1/api-error");
    for (const code of ["MEDIA_SERIES_QUERY_INVALID", "MEDIA_SERIES_COMMAND_INVALID", "MEDIA_SERIES_NOT_AVAILABLE", "MEDIA_SERIES_CURSOR_INVALID", "MEDIA_SERIES_REVISION_CONFLICT", "MEDIA_SERIES_IDEMPOTENCY_CONFLICT", "MEDIA_SERIES_MEMBERSHIP_CONFLICT", "MEDIA_SERIES_UNAVAILABLE"]) {
      expect(apiError({ code, message: "Request failed", retryable: false })).toBe(true);
      expect(API_ERROR_CODES).toContain(code);
      expect(defaultRetryable(code)).toBe(code === "MEDIA_SERIES_UNAVAILABLE");
    }
  });
});
