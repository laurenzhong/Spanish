// @vitest-environment node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDrizzleContentAcquisitionRepository } from "@/src/modules/content-acquisition";
import type { Database } from "@/src/shared/db/client";
import * as schema from "@/src/shared/db/schema";

const sourceId = "00000000-0000-4000-8000-000000000741";
const candidateId = "00000000-0000-4000-8000-000000000742";

async function migrations() {
  const names = (await readdir(path.join(process.cwd(), "drizzle"))).filter((name) => /^002[12]_.+\.sql$/u.test(name)).sort();
  return Promise.all(names.map(async (name) => (await readFile(path.join(process.cwd(), "drizzle", name), "utf8")).replaceAll("--> statement-breakpoint", "")));
}

describe("content review and publication transactions", () => {
  let client: PGlite;
  let database: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(async () => {
    client = new PGlite();
    for (const migration of await migrations()) await client.exec(migration);
    database = drizzle(client, { schema });
    await database.insert(schema.acquisitionSources).values({ id: sourceId, stableKey: "review.fixture", adapterType: "fake", sourceKind: "article-feed", externalSourceId: "review-feed", displayName: "Review fixture", language: "es", enabled: true, rightsStatus: "verified" });
    await database.insert(schema.contentCandidates).values({ id: candidateId, sourceId, externalItemId: "article-1", normalizedUrl: "https://example.test/article-1", title: "Artículo", contentType: "article", language: "es", contentHash: "a".repeat(64), metadata: { structure: "valid" }, status: "review_ready", rightsStatus: "verified", generationId: "generation-1", revision: 5, lastActivityAt: new Date("2026-09-13T00:00:00.000Z") });
  });

  afterEach(async () => client.close());

  function repository() { return createDrizzleContentAcquisitionRepository(database as unknown as Database); }

  it("keeps review notes by revision when changes are requested and processing is retried", async () => {
    await repository().saveCandidateReview({ id: "00000000-0000-4000-8000-000000000743", candidateId, expectedRevision: 5, dimension: "structure", status: "changes_requested", reviewerReference: "codex-ai-owner-authorized-review", notes: "第二段缺少来源位置。", updatedAt: new Date("2026-09-13T01:00:00.000Z") });
    const next = await repository().requestCandidateReprocessing({ candidateId, expectedRevision: 5, generationId: "generation-2", updatedAt: new Date("2026-09-13T01:01:00.000Z") });
    expect(next).toMatchObject({ status: "processing", revision: 6, generationId: "generation-2" });
    const detail = await repository().getCandidateReview(candidateId);
    expect(detail?.reviews).toContainEqual(expect.objectContaining({ candidateRevision: 5, status: "changes_requested", notes: expect.stringContaining("第二段缺少来源位置。") }));
  });

  it("keeps earlier notes when the same revision is later approved", async () => {
    const firstId = "00000000-0000-4000-8000-000000000745";
    await repository().saveCandidateReview({ id: firstId, candidateId, expectedRevision: 5, dimension: "content-es-ES", status: "changes_requested", reviewerReference: "codex-ai-owner-authorized-review", notes: "需修正重音符号。", updatedAt: new Date("2026-09-13T01:00:00.000Z") });
    const approved = await repository().saveCandidateReview({ id: "00000000-0000-4000-8000-000000000746", candidateId, expectedRevision: 5, dimension: "content-es-ES", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", notes: null, updatedAt: new Date("2026-09-13T01:05:00.000Z") });
    expect(approved).toMatchObject({ id: firstId, status: "approved" });
    expect(approved.notes).toContain("需修正重音符号。");
  });

  it("rolls back publication state when the owner-release audit write fails", async () => {
    const duplicateReviewId = "00000000-0000-4000-8000-000000000744";
    await database.insert(schema.candidateReviews).values([
      { id: duplicateReviewId, candidateId, dimension: "structure", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5 },
      { id: "00000000-0000-4000-8000-000000000747", candidateId, dimension: "content-es-ES", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5 },
      { id: "00000000-0000-4000-8000-000000000748", candidateId, dimension: "teaching-zh-CN", status: "approved", reviewerReference: "codex-ai-owner-authorized-review", candidateRevision: 5 },
    ]);
    await expect(repository().markCandidatePublished({ reviewId: duplicateReviewId, candidateId, expectedRevision: 5, expectedContentHash: "a".repeat(64), publicationRef: { kind: "article", stableKey: "article.fixture", version: 1 }, reviewerReference: "codex-ai-owner-authorized-review", publishedAt: new Date("2026-09-13T02:00:00.000Z") })).rejects.toThrow();
    await expect(repository().findCandidateById(candidateId)).resolves.toMatchObject({ publicationStatus: "draft", publicationRef: null });
  });
});
