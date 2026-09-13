// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

function validator(schemaId: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const directory = path.join(process.cwd(), "contracts", "schemas", "v1");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".schema.json"))) {
    ajv.addSchema(JSON.parse(readFileSync(path.join(directory, file), "utf8")));
  }
  const validate = ajv.getSchema(schemaId);
  expect(validate).toBeDefined();
  return validate!;
}

const candidate = {
  id: "00000000-0000-4000-8000-000000000751",
  sourceId: "00000000-0000-4000-8000-000000000752",
  externalItemId: "article-1",
  normalizedUrl: "https://example.test/article-1",
  title: "Artículo",
  contentType: "article",
  language: "es",
  metadata: {},
  publishedAt: null,
  contentHash: "a".repeat(64),
  status: "review_ready",
  rightsStatus: "verified",
  generationId: "generation-1",
  revision: 5,
  lastActivityAt: "2026-09-13T00:00:00.000Z",
  rejectedAt: null,
  publicationStatus: "draft",
  publicationRef: null,
  publishedCandidateRevision: null,
  publishedContentHash: null,
  publishedAtInternal: null,
  archivedAt: null,
};

describe("content workflow v1 contracts", () => {
  it("validates candidate lists and rejects undeclared browser fields", () => {
    const validate = validator("content-workflow-candidate-list-response.schema.json");
    expect(validate({ apiVersion: "v1", data: { candidates: [candidate] } }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ apiVersion: "v1", data: { candidates: [{ ...candidate, ownerEmail: "private@example.test" }] } })).toBe(false);
  });

  it("validates review and immutable publication results", () => {
    const review = validator("content-workflow-review-response.schema.json");
    expect(review({ apiVersion: "v1", data: { review: { id: "review-1", candidateId: candidate.id, dimension: "content-es-ES", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5, notes: null } } }), JSON.stringify(review.errors)).toBe(true);
    const publication = validator("content-workflow-publication-response.schema.json");
    const published = { ...candidate, publicationStatus: "published", publicationRef: { kind: "article", stableKey: "article.fixture", version: 1 }, publishedCandidateRevision: 5, publishedContentHash: candidate.contentHash, publishedAtInternal: "2026-09-13T01:00:00.000Z" };
    expect(publication({ apiVersion: "v1", data: { candidate: published, publicationRef: published.publicationRef } }), JSON.stringify(publication.errors)).toBe(true);
  });

  it("validates the owner-only candidate review projection", () => {
    const detail = validator("content-workflow-candidate-detail-response.schema.json");
    expect(detail({ apiVersion: "v1", data: { candidate: {
      candidate,
      source: { id: candidate.sourceId, displayName: "Fixture source", rightsStatus: "verified" },
      artifacts: [], attempts: [], reviews: [], publisherAvailable: false,
    } } }), JSON.stringify(detail.errors)).toBe(true);
  });
});
