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
      id: "20000000-0000-4000-8000-000000000001", expression: "¿Qué tal?", normalizedExpression: "que tal", scope: "public", pragmaticPurpose: null,
      register: "neutral", region: "es-ES", cefr: "A2", meaningZh: "怎么样", variants: [], occurrenceCount: 0, representativeOccurrence: null, intent: "revisit", revision: 2,
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
    expect(openapi.paths["/lexicon/vocabulary"].get.parameters.map((parameter: { name: string }) => parameter.name)).toContain("lemmaStatus");
    expect(openapi.paths["/lexicon/phrases"]).toBeDefined();
    expect(openapi.paths["/lexicon/phrases"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(expect.arrayContaining(["pragmaticPurpose", "register", "region", "cefr"]));
    expect(openapi.paths["/lexicon/intents/{entryId}"].put.requestBody.content["application/json"].schema.$ref).toContain("lexical-intent-request");
  });

  it("keeps corpus and assessment contracts bounded", () => {
    const corpus = validator("corpus-search-response.schema.json");
    expect(corpus({ apiVersion: "v1", data: { items: [{ leftContext: "Quiero", keyword: "comer", rightContext: " aquí.", sourceTitle: "Una historia", sourceKind: "article-rss", document: { kind: "article", stableKey: "article.one", version: 1 }, location: { kind: "text", paragraphId: "p1", segmentIndex: 0 }, entryKind: "lexeme", entryId: vocabulary.id, surfaceText: "comer" }], page: 1, pageSize: 20, total: 1 } }), JSON.stringify(corpus.errors)).toBe(true);
    const assessment = validator("lexical-assessment-response.schema.json");
    expect(assessment({ apiVersion: "v1", data: { id: vocabulary.id, assessmentKey: "lexical.core", version: 1, entryKind: "lexeme", entryId: null, promptType: "recall", prompt: "回忆", options: [], sourceReference: {}, contentVersion: 1 } })).toBe(true);
    expect(assessment({ apiVersion: "v1", data: { id: vocabulary.id, assessmentKey: "lexical.core", version: 1, entryKind: "lexeme", entryId: null, promptType: "recall", prompt: "回忆", options: [], acceptedAnswers: ["comer"], sourceReference: {}, contentVersion: 1 } })).toBe(false);
    const attempt = validator("lexical-assessment-attempt-response.schema.json");
    expect(attempt({ apiVersion: "v1", data: { attemptId: vocabulary.id, assessmentKey: "lexical.core", version: 1, answer: "comer", passed: true, score: 1, normalizedAnswer: "comer", duplicate: false, evidence: "recorded" } })).toBe(true);
    const openapi = JSON.parse(readFileSync(path.join(process.cwd(), "contracts", "openapi", "v1", "openapi.json"), "utf8"));
    expect(openapi.paths["/corpus/search"].get.responses["200"].content["application/json"].schema.$ref).toContain("corpus-search-response");
    expect(openapi.paths["/corpus/search"].get.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(expect.arrayContaining(["q", "match", "entryKind", "entryId"]));
    expect(openapi.paths["/lexicon/assessments/{assessmentId}/attempts"].post.parameters.some((parameter: { name: string }) => parameter.name === "Idempotency-Key")).toBe(true);
  });
});
