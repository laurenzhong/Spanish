import { randomUUID } from "node:crypto";

import { ContentPublicationConflictError, assertCandidatePublishable } from "../domain";
import type { ArticlePublicationMode } from "../domain/article-publication-policy";
import type { CandidatePublisherRegistry } from "../publishers";
import type { ContentWorkflowRepository } from "../repositories";

export const ARTICLE_AUTO_PUBLICATION_ACTOR_PREFIX = "article-auto-publication:";
const READLANG_SOURCE_URL = "https://readlang.com/es/links";

export type AutoPublishArticleResult = Readonly<{
  status: "published" | "skipped" | "failed";
  candidateId: string;
  publicationRef: Readonly<{ kind: "article"; stableKey: string; version: number }> | null;
  reason: string | null;
}>;

function approvedAt(value: unknown): boolean {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function policyEnabled(source: Readonly<{ enabled: boolean; adapterType: string; sourceKind: string; externalSourceId: string; rightsStatus: string; rightsPolicy?: Readonly<Record<string, unknown>> }>, policyVersion: string): boolean {
  const policy = source.rightsPolicy?.automatedPublication;
  if (!policy || typeof policy !== "object") return false;
  const value = policy as Readonly<Record<string, unknown>>;
  return source.enabled
    && ((source.adapterType === "article-rss" && source.sourceKind === "article-feed")
      || (source.adapterType === "readlang-links" && source.sourceKind === "article-site" && source.externalSourceId === READLANG_SOURCE_URL))
    && source.rightsStatus === "verified"
    && value.enabled === true
    && value.policyVersion === policyVersion
    && approvedAt(value.approvedAt);
}

export async function autoPublishArticleCandidate(
  repository: ContentWorkflowRepository,
  publishers: CandidatePublisherRegistry,
  input: Readonly<{
    candidateId: string;
    mode: ArticlePublicationMode;
    policyVersion: string;
    actor: string;
    runId?: string;
    makeReviewId?: () => string;
    now?: () => Date;
  }>,
): Promise<AutoPublishArticleResult> {
  const skip = (reason: string): AutoPublishArticleResult => ({ status: "skipped", candidateId: input.candidateId, publicationRef: null, reason });
  if (input.mode !== "auto-publish") return skip("MODE_NOT_AUTO_PUBLISH");
  if (input.actor !== `${ARTICLE_AUTO_PUBLICATION_ACTOR_PREFIX}${input.policyVersion}`) return skip("ACTOR_MISMATCH");
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) return skip("CANDIDATE_NOT_FOUND");
  const { candidate } = detail;
  if (candidate.contentType !== "article" || !candidate.contentHash) return skip("CANDIDATE_NOT_ARTICLE");
  if (
    candidate.publicationStatus === "published"
    && candidate.publishedCandidateRevision === candidate.revision
    && candidate.publishedContentHash === candidate.contentHash
    && candidate.publicationRef?.kind === "article"
  ) {
    return {
      status: "published",
      candidateId: candidate.id,
      publicationRef: {
        kind: "article",
        stableKey: candidate.publicationRef.stableKey,
        version: candidate.publicationRef.version,
      },
      reason: null,
    };
  }
  const source = repository.findSourceById ? await repository.findSourceById(candidate.sourceId) : null;
  if (!source || !policyEnabled(source, input.policyVersion)) return skip("SOURCE_POLICY_NOT_APPROVED");
  try {
    assertCandidatePublishable(candidate, detail.reviews, { expectedRevision: candidate.revision, expectedContentHash: candidate.contentHash });
  } catch (error) {
    return skip(error instanceof Error ? error.message : "CANDIDATE_NOT_PUBLISHABLE");
  }
  const publisher = publishers.require("article");
  const publicationRef = await publisher.publish({
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    contentHash: candidate.contentHash,
    contentType: candidate.contentType,
    title: candidate.title,
    language: candidate.language,
    normalizedUrl: candidate.normalizedUrl,
    metadata: candidate.metadata,
    reviews: detail.reviews,
  });
  if (publicationRef.kind !== "article") {
    await publisher.archive({ publication: publicationRef, candidateId: candidate.id }).catch(() => undefined);
    return { status: "failed", candidateId: candidate.id, publicationRef: null, reason: "ARTICLE_PUBLISHER_RETURNED_NON_ARTICLE" };
  }
  const articlePublicationRef: Readonly<{ kind: "article"; stableKey: string; version: number }> = {
    kind: "article",
    stableKey: publicationRef.stableKey,
    version: publicationRef.version,
  };
  try {
    await repository.markCandidatePublished({
      reviewId: (input.makeReviewId ?? randomUUID)(),
      candidateId: candidate.id,
      expectedRevision: candidate.revision,
      expectedContentHash: candidate.contentHash,
      publicationRef: articlePublicationRef,
      reviewerReference: `codex-ai-owner-authorized-review:${input.actor}${input.runId ? `:${input.runId}` : ""}`,
      publishedAt: (input.now ?? (() => new Date()))(),
    });
  } catch (error) {
    await publisher.archive({ publication: publicationRef, candidateId: candidate.id }).catch(() => undefined);
    if (error instanceof ContentPublicationConflictError) return { status: "failed", candidateId: candidate.id, publicationRef: null, reason: error.message };
    return { status: "failed", candidateId: candidate.id, publicationRef: null, reason: error instanceof Error ? error.message : "PUBLICATION_COMMIT_FAILED" };
  }
  return { status: "published", candidateId: candidate.id, publicationRef: articlePublicationRef, reason: null };
}
