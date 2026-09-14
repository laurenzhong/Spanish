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
  return ajv.getSchema(`https://spanish.local/contracts/v1/${name}`)!;
}

const vocabulary = {
  id: "10000000-0000-4000-8000-000000000001", lemma: "comer", normalizedLemma: "comer", partOfSpeech: "verb", lemmaStatus: "verified",
  meaningZh: "吃", forms: ["comer"], occurrenceCount: 1, intent: null, revision: 1,
};

describe("lexicon v1 contracts", () => {
  it("validates vocabulary and phrase list projections", () => {
    const list = validator("lexicon-list-response.schema.json");
    expect(list({ apiVersion: "v1", data: { items: [vocabulary], page: 1, pageSize: 24, total: 1 } }), JSON.stringify(list.errors)).toBe(true);
    expect(list({ apiVersion: "v1", data: { items: [{ ...vocabulary, internalLocator: "private" }], page: 1, pageSize: 24, total: 1 } })).toBe(false);
    expect(list({ apiVersion: "v1", data: { items: [{
      id: "20000000-0000-4000-8000-000000000001", expression: "¿Qué tal?", normalizedExpression: "que tal", pragmaticPurpose: null,
      register: "neutral", region: "es-ES", cefr: "A2", meaningZh: "怎么样", variants: [], occurrenceCount: 0, intent: "revisit", revision: 2,
    }], page: 1, pageSize: 24, total: 1 } }), JSON.stringify(list.errors)).toBe(true);
  });

  it("validates revisioned intent writes and registers every route", () => {
    const request = validator("lexical-intent-request.schema.json");
    expect(request({ entryKind: "phrase", intent: "revisit", expectedRevision: 2 })).toBe(true);
    expect(request({ entryKind: "lexeme", intent: "revisit", expectedRevision: 0 })).toBe(false);
    const response = validator("lexical-intent-response.schema.json");
    expect(response({ apiVersion: "v1", data: { entryKind: "lexeme", entryId: vocabulary.id, intent: "familiar", revision: 2 } })).toBe(true);

    const openapi = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "openapi", "v1", "openapi.json"), "utf8"));
    expect(openapi.paths["/lexicon/vocabulary"].get.responses["200"].content["application/json"].schema.$ref).toContain("lexicon-list-response");
    expect(openapi.paths["/lexicon/phrases"]).toBeDefined();
    expect(openapi.paths["/lexicon/intents/{entryId}"].put.requestBody.content["application/json"].schema.$ref).toContain("lexical-intent-request");
  });
});
