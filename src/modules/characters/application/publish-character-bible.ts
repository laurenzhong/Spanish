import {
  canPublishCharacterRevision,
  CharacterCanonValidationError,
  validateCharacterBible,
} from "../domain";
import type { CharacterBible } from "../schemas";
import { profileFor, sameCharacterContent } from "./import-character-bible";
import {
  type CharacterPublicationReview,
  type CharacterRepository,
  type PersistedCharacter,
} from "../repositories";

export const TEMPORARY_AI_REVIEWER_REFERENCE = "codex-ai-temporary-review";

export class CharacterPublishError extends Error {
  constructor(
    readonly code:
      | "CHARACTER_UNAVAILABLE"
      | "CHARACTER_CONTENT_MISMATCH"
      | "CHARACTER_STATUS_NOT_PUBLISHABLE"
      | "CHARACTER_REVIEW_INVALID",
  ) {
    super(code);
    this.name = "CharacterPublishError";
  }
}

export type PublishCharacterResult = Readonly<{
  character: PersistedCharacter;
  status: "published" | "unchanged";
  reviews: readonly CharacterPublicationReview[];
}>;

function temporaryReviews(reviewedAt: Date): readonly CharacterPublicationReview[] {
  return [
    {
      locale: "es-ES",
      reviewerReference: `${TEMPORARY_AI_REVIEWER_REFERENCE}:language`,
      notes: "Temporary AI language review authorized by the project owner; native-speaker review remains recommended.",
      reviewedAt,
    },
    {
      locale: "zh-CN",
      reviewerReference: `${TEMPORARY_AI_REVIEWER_REFERENCE}:pedagogy`,
      notes: "Temporary AI pedagogy-risk review authorized by the project owner; teaching-expert review remains recommended.",
      reviewedAt,
    },
    {
      locale: "es-ES",
      reviewerReference: `${TEMPORARY_AI_REVIEWER_REFERENCE}:canon`,
      notes: "Temporary AI canon, privacy, and character-boundary review authorized by the project owner.",
      reviewedAt,
    },
  ];
}

function publishableCandidate(source: CharacterBible): CharacterBible {
  const candidate = { ...source, status: "published" as const };
  const result = canPublishCharacterRevision(null, candidate, { approvedReview: true });
  if (!result.ok) throw new CharacterPublishError("CHARACTER_REVIEW_INVALID");
  return candidate;
}

function parseCandidate(source: unknown): CharacterBible {
  try {
    return publishableCandidate(validateCharacterBible(source));
  } catch (error) {
    if (error instanceof CharacterCanonValidationError) {
      throw new CharacterPublishError("CHARACTER_REVIEW_INVALID");
    }
    throw error;
  }
}

async function publishPreparedCharacter(
  repository: CharacterRepository,
  candidate: CharacterBible,
  reviews: readonly CharacterPublicationReview[],
): Promise<PublishCharacterResult> {
  let existing = await repository.findByStableVersion(candidate.stableKey, candidate.version);
  if (!existing) throw new CharacterPublishError("CHARACTER_UNAVAILABLE");
  let persistedCandidate = { ...candidate, status: existing.status } as CharacterBible;
  if (!sameCharacterContent(existing, persistedCandidate) && existing.status === "draft") {
    existing = await repository.replaceDraft({ character: candidate, profile: profileFor(candidate) });
    persistedCandidate = { ...candidate, status: existing.status } as CharacterBible;
  }
  if (!sameCharacterContent(existing, persistedCandidate)) {
    throw new CharacterPublishError("CHARACTER_CONTENT_MISMATCH");
  }
  const published = await repository.publish({
    stableKey: candidate.stableKey,
    version: candidate.version,
    reviews,
  });
  return {
    character: published,
    status: existing.status === "published" ? "unchanged" : "published",
    reviews,
  };
}

export async function publishCharacterBible(input: Readonly<{
  repository: CharacterRepository;
  source: unknown;
  reviewedAt?: Date;
}>): Promise<PublishCharacterResult> {
  const candidate = parseCandidate(input.source);
  const reviews = temporaryReviews(input.reviewedAt ?? new Date());
  return input.repository.transaction((repository) => publishPreparedCharacter(repository, candidate, reviews));
}

export async function publishCharacterBibles(input: Readonly<{
  repository: CharacterRepository;
  sources: readonly unknown[];
  reviewedAt?: Date;
}>): Promise<readonly PublishCharacterResult[]> {
  const reviewedAt = input.reviewedAt ?? new Date();
  const prepared = input.sources.map((source) => ({
    candidate: parseCandidate(source),
    reviews: temporaryReviews(reviewedAt),
  }));
  return input.repository.transaction((repository) =>
    Promise.all(prepared.map(({ candidate, reviews }) => publishPreparedCharacter(repository, candidate, reviews))),
  );
}
