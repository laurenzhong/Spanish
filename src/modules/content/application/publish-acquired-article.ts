import type {
  AcquiredArticleDraft,
  AcquiredArticlePublication,
  AcquiredArticleRepository,
  AcquiredArticleReview,
} from "../repositories/acquired-article-repository";

export async function publishAcquiredArticle(
  repository: AcquiredArticleRepository,
  input: Readonly<{
    candidateId: string;
    candidateRevision: number;
    contentHash: string;
    draft: AcquiredArticleDraft;
    reviews: readonly [AcquiredArticleReview, AcquiredArticleReview];
    publishedAt: Date;
  }>,
): Promise<AcquiredArticlePublication> {
  return repository.publishAcquired(input);
}

export async function archiveAcquiredArticle(
  repository: AcquiredArticleRepository,
  input: Readonly<{
    candidateId: string;
    publication: AcquiredArticlePublication;
    archivedAt: Date;
  }>,
): Promise<void> {
  return repository.archiveAcquired(input);
}
