import { randomUUID } from "node:crypto";

import { validateSegmentTimeline } from "@/src/modules/media/domain";

import { calculatePodcastCandidateContentHash, calculateVideoCandidateContentHash, podcastCandidateDraftSchema, videoCandidateDraftSchema } from "../normalizers";
import { OWNER_AUTHORIZED_REVIEWER_REFERENCE } from "../domain";
import type { ContentCandidateRecord, ContentWorkflowRepository } from "../repositories";
import { mediaReviewInputHash, mediaReviewResultSchema, type MediaReviewProvider, type MediaReviewResult } from "../providers/media-review";

const REVIEWER_REFERENCE = OWNER_AUTHORIZED_REVIEWER_REFERENCE;

export type MediaReviewRunResult = Readonly<{
  status: "approved" | "changes_requested" | "rejected" | "failed";
  candidateId: string;
  candidateRevision: number;
  contentHash: string | null;
  reviewsWritten: number;
  reason: string | null;
  providerResults: Readonly<Record<string, MediaReviewResult | null>>;
}>;

function structureReview(candidate: ContentCandidateRecord, draft: unknown): MediaReviewResult {
  try {
    const parsed = candidate.contentType === "video" ? videoCandidateDraftSchema.parse(draft) : podcastCandidateDraftSchema.parse(draft);
    const expectedHash = candidate.contentType === "video"
      ? calculateVideoCandidateContentHash(videoCandidateDraftSchema.parse(draft))
      : calculatePodcastCandidateContentHash(podcastCandidateDraftSchema.parse(draft));
    if (candidate.contentHash !== parsed.contentHash || candidate.contentHash !== expectedHash || candidate.normalizedUrl !== parsed.canonicalUrl || candidate.title !== parsed.title || candidate.language !== "es" || candidate.rightsStatus !== "verified") {
      throw new Error("immutable fields");
    }
    if (parsed.segments.length > 0) validateSegmentTimeline(parsed.segments, parsed.durationMs);
    if (candidate.contentType === "video") {
      const video = videoCandidateDraftSchema.parse(draft);
      if (video.captionStatus === "unavailable" ? video.segments.length !== 0 : video.segments.length === 0) throw new Error("caption state");
    } else {
      const podcast = podcastCandidateDraftSchema.parse(draft);
      if (podcast.transcriptStatus === "unavailable" ? podcast.segments.length !== 0 || podcast.transcriptUrl !== null : podcast.segments.length === 0) throw new Error("transcript state");
    }
    return { decision: "approved", notes: "Media draft schema, immutable fields, rights, and timeline are consistent.", modelVersion: "deterministic-media-structure-v1", inputHash: "" };
  } catch {
    return { decision: "changes_requested", notes: "Media draft does not satisfy the immutable publication schema or timeline gate.", modelVersion: "deterministic-media-structure-v1", inputHash: "" };
  }
}

export async function runMediaReview(repository: ContentWorkflowRepository, input: Readonly<{ candidateId: string; contentProvider: MediaReviewProvider; teachingProvider: MediaReviewProvider; timeoutMs?: number; makeId?: () => string; now?: () => Date }>): Promise<MediaReviewRunResult> {
  const detail = await repository.getCandidateReview(input.candidateId);
  if (!detail) return { status: "failed", candidateId: input.candidateId, candidateRevision: 0, contentHash: null, reviewsWritten: 0, reason: "CANDIDATE_NOT_FOUND", providerResults: {} };
  const { candidate } = detail;
  const draft = candidate.metadata[candidate.contentType === "video" ? "videoDraft" : "podcastDraft"];
  if ((candidate.contentType !== "video" && candidate.contentType !== "podcast") || candidate.status !== "review_ready" || candidate.publicationStatus !== "draft" || !candidate.contentHash || !draft || typeof draft !== "object") return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: "CANDIDATE_NOT_REVIEWABLE", providerResults: {} };
  const parsed = candidate.contentType === "video" ? videoCandidateDraftSchema.safeParse(draft) : podcastCandidateDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}:${issue.code}`).slice(0, 8).join(",");
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: `INVALID_MEDIA_DRAFT:${paths || "schema"}`, providerResults: {} };
  }
  const reviewInput = { candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, contentType: candidate.contentType, title: candidate.title, summary: parsed.data.summary, draft: parsed.data } as const;
  const expectedInputHash = mediaReviewInputHash(reviewInput);
  const providerResults: Record<string, MediaReviewResult | null> = {};
  const timeoutMs = input.timeoutMs ?? 60_000;
  const run = async (provider: MediaReviewProvider): Promise<MediaReviewResult> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        return await Promise.race([
          provider.review(reviewInput),
          new Promise<MediaReviewResult>((_, reject) => setTimeout(() => reject(new Error("MEDIA_REVIEW_TIMEOUT")), timeoutMs)),
        ]);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "MEDIA_REVIEW_FAILED";
        const retryable = message.startsWith("MEDIA_REVIEW_PROVIDER_RESPONSE_INVALID")
          || message === "MEDIA_REVIEW_PROVIDER_TIMEOUT"
          || message === "MEDIA_REVIEW_PROVIDER_UNAVAILABLE"
          || message === "MEDIA_REVIEW_PROVIDER_RATE_LIMITED";
        if (!retryable || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("MEDIA_REVIEW_FAILED");
  };
  try {
    const [content, teaching] = await Promise.all([run(input.contentProvider), run(input.teachingProvider)]);
    if (input.contentProvider.dimension !== "content-es-ES" || input.teachingProvider.dimension !== "teaching-zh-CN") throw new Error("MEDIA_REVIEW_PROVIDER_DIMENSION_MISMATCH");
    if (content.inputHash !== expectedInputHash || teaching.inputHash !== expectedInputHash) throw new Error("MEDIA_REVIEW_INPUT_HASH_MISMATCH");
    providerResults["content-es-ES"] = mediaReviewResultSchema.parse(content);
    providerResults["teaching-zh-CN"] = mediaReviewResultSchema.parse(teaching);
  } catch (error) {
    return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: error instanceof Error ? error.message : "MEDIA_REVIEW_FAILED", providerResults };
  }
  const structure = { ...structureReview(candidate, parsed.data), inputHash: expectedInputHash };
  providerResults.structure = structure;
  const latest = await repository.getCandidateReview(candidate.id);
  if (!latest || latest.candidate.revision !== candidate.revision || latest.candidate.contentHash !== candidate.contentHash) return { status: "failed", candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten: 0, reason: "CANDIDATE_CHANGED_DURING_REVIEW", providerResults };
  const reviewedAt = (input.now ?? (() => new Date()))();
  let reviewsWritten = 0;
  for (const [dimension, result] of [["content-es-ES", providerResults["content-es-ES"]], ["teaching-zh-CN", providerResults["teaching-zh-CN"]], ["structure", structure]] as const) {
    if (!result) continue;
    await repository.saveCandidateReview({ id: (input.makeId ?? randomUUID)(), candidateId: candidate.id, expectedRevision: candidate.revision, dimension, status: result.decision, reviewerReference: REVIEWER_REFERENCE, notes: result.notes, updatedAt: reviewedAt });
    reviewsWritten += 1;
  }
  const decisions = [providerResults["content-es-ES"]?.decision, providerResults["teaching-zh-CN"]?.decision, structure.decision];
  const status = decisions.includes("rejected") ? "rejected" : decisions.every((decision) => decision === "approved") ? "approved" : "changes_requested";
  return { status, candidateId: candidate.id, candidateRevision: candidate.revision, contentHash: candidate.contentHash, reviewsWritten, reason: status === "approved" ? null : "MEDIA_REVIEW_NOT_APPROVED", providerResults };
}
