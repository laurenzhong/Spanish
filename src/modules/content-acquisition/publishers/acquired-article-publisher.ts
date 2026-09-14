import { archiveAcquiredArticle, publishAcquiredArticle } from "@/src/modules/content/application/publish-acquired-article";
import type { AcquiredArticleRepository, AcquiredArticleReview } from "@/src/modules/content/repositories/acquired-article-repository";

import { articleCandidateDraftSchema } from "../normalizers";
import type { CandidatePublisher, CandidatePublisherInput } from "./candidate-publisher";

export class ArticlePublicationConflictError extends Error {
  readonly code = "CONTENT_PUBLICATION_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "ArticlePublicationConflictError";
  }
}

function requiredReview(
  input: CandidatePublisherInput,
  dimension: "content-es-ES" | "teaching-zh-CN",
  locale: AcquiredArticleReview["locale"],
  reviewedAt: Date,
): AcquiredArticleReview {
  const review = input.reviews.find((candidate) =>
    candidate.dimension === dimension
    && candidate.status === "approved"
    && candidate.candidateRevision === input.candidateRevision
    && candidate.reviewerReference === "codex-ai-owner-authorized-review",
  );
  if (!review) throw new ArticlePublicationConflictError(`The ${dimension} review is missing or stale.`);
  return { locale, reviewerReference: "codex-ai-owner-authorized-review", notes: review.notes, reviewedAt };
}

export class AcquiredArticlePublisher implements CandidatePublisher {
  readonly contentType = "article" as const;

  constructor(
    private readonly repository: AcquiredArticleRepository,
    private readonly dependencies: Readonly<{ now?: () => Date }> = {},
  ) {}

  async publish(input: CandidatePublisherInput) {
    let draft;
    try {
      draft = articleCandidateDraftSchema.parse(input.metadata.articleDraft);
    } catch {
      throw new ArticlePublicationConflictError("The reviewed article draft is missing or invalid.");
    }
    if (
      input.contentType !== "article"
      || input.contentHash !== draft.contentHash
      || input.normalizedUrl !== draft.canonicalUrl
      || input.title !== draft.title
      || input.language !== "es"
    ) {
      throw new ArticlePublicationConflictError("The article candidate no longer matches its reviewed draft.");
    }
    const reviewedAt = (this.dependencies.now ?? (() => new Date()))();
    const reviews = [
      requiredReview(input, "content-es-ES", "es-ES", reviewedAt),
      requiredReview(input, "teaching-zh-CN", "zh-CN", reviewedAt),
    ] as const;
    return publishAcquiredArticle(this.repository, {
      candidateId: input.candidateId,
      candidateRevision: input.candidateRevision,
      contentHash: input.contentHash,
      draft,
      reviews,
      publishedAt: reviewedAt,
    });
  }

  async archive(input: Readonly<{ publication: { kind: "article" | "media"; stableKey: string; version: number }; candidateId: string }>) {
    if (input.publication.kind !== "article") {
      throw new ArticlePublicationConflictError("An article publisher cannot archive a media publication.");
    }
    return archiveAcquiredArticle(this.repository, {
      candidateId: input.candidateId,
      publication: { ...input.publication, kind: "article" },
      archivedAt: (this.dependencies.now ?? (() => new Date()))(),
    });
  }
}
