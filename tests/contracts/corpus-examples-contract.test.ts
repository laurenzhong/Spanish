// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

function readContract(name: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "schemas", "v1", `${name}.schema.json`), "utf8"));
}

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readContract(name));
}

const example = {
  id: "media:podcast.one:2:3", text: "¿Te apetece un café?", translation: "想喝咖啡吗？",
  before: "Ya hemos terminado.", after: "Claro, gracias.", sourceTitle: "Una conversación", sourceName: "Podcast",
  contentKind: "podcast", document: { kind: "media", stableKey: "podcast.one", version: 2 },
  location: { kind: "media", startMs: 4000, endMs: 6000, segmentIndex: 3 },
};
const response = { apiVersion: "v1", data: { items: [example], total: 1, page: 1, pageSize: 12 } };
const entryId = "10000000-0000-4000-8000-000000000001";

describe("corpus examples v1 contracts", () => {
  it("accepts complete media/text examples, missing translations and an empty out-of-range page", () => {
    const validate = validator("corpus-examples-response");
    expect(validate(response), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ apiVersion: "v1", data: { items: [{ ...example, contentKind: "article", translation: null, before: null, after: null, document: { kind: "article", stableKey: "article.one", version: 1 }, location: { kind: "text", paragraphId: "segment-0", segmentIndex: 0 } }], total: 1, page: 1, pageSize: 12 } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ apiVersion: "v1", data: { items: [], total: 5, page: 9, pageSize: 12 } })).toBe(true);
  });

  it("rejects unknown public fields and malformed versions or source coordinates", () => {
    const validate = validator("corpus-examples-response");
    expect(validate({ ...response, internalToken: "private" })).toBe(false);
    expect(validate({ ...response, apiVersion: "v2" })).toBe(false);
    expect(validate({ ...response, data: { ...response.data, ownerUserId: entryId } })).toBe(false);
    for (const invalid of [
      { ...example, ownerUserId: entryId },
      { ...example, document: { ...example.document, version: 0 } },
      { ...example, document: { ...example.document, sourceUrl: "private" } },
      { ...example, location: { ...example.location, startMs: -1 } },
      { ...example, location: { ...example.location, endMs: 0 } },
      { ...example, location: { ...example.location, segmentIndex: 1.5 } },
      { ...example, location: { ...example.location, paragraphId: "unexpected" } },
      { ...example, translation: undefined },
    ]) expect(validate({ ...response, data: { ...response.data, items: [invalid] } })).toBe(false);
  });

  it("bounds all query fields and requires the legacy entry pair together", () => {
    const validate = validator("corpus-examples-query");
    expect(validate({})).toBe(true);
    expect(validate({ query: "café", match: "all", page: 1000, pageSize: 24, documentKind: "media", contentKind: "podcast", stableKey: "podcast.one", sourceKind: "Podcast", entryKind: "lexeme", entryId }), JSON.stringify(validate.errors)).toBe(true);
    for (const invalid of [
      { pageSize: 25 }, { pageSize: 0 }, { page: 100001 }, { page: 0 }, { page: 1.5 },
      { query: "x".repeat(121) }, { stableKey: "x".repeat(241) }, { sourceKind: "x".repeat(81) },
      { match: "semantic" }, { contentKind: "audio" }, { entryKind: "phrase" }, { entryId },
      { entryKind: "phrase", entryId: "bad-uuid" }, { unexpected: true },
    ]) expect(validate(invalid), JSON.stringify(invalid)).toBe(false);
  });

  it("publishes authenticated GET with bounded parameters and v1 response/error contracts", () => {
    const openapi = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "openapi", "v1", "openapi.json"), "utf8"));
    const route = openapi.paths["/corpus/examples"].get;
    expect(route.security).toEqual([{ bearerAuth: [] }]);
    expect(openapi.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(route.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(expect.arrayContaining(["query", "match", "contentKind", "documentKind", "stableKey", "sourceKind", "entryKind", "entryId", "page", "pageSize"]));
    expect(route.parameters.find((parameter: { name: string }) => parameter.name === "pageSize").schema).toMatchObject({ maximum: 24, default: 12 });
    expect(route.responses["200"].content["application/json"].schema.$ref).toBe("../../schemas/v1/corpus-examples-response.schema.json");
    for (const status of ["400", "401", "503"]) expect(route.responses[status].content["application/json"].schema.$ref).toBe("../../schemas/v1/error-response.schema.json");
    expect(route.description).toContain("private, no-store");
    expect(route.description).toContain("corpus-examples-query.schema.json");
  });
});
