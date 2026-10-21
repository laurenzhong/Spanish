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

// Historical temporary review identity. Character publication records written by
// the previous agent platform are immutable audit evidence, so this value stays.
// New expression, article, and media reviews use the current owner-authorized
// reference from `content-acquisition/domain/review-identity`.
export const TEMPORARY_AI_REVIEWER_REFERENCE = "codex-ai-temporary-review";
export const OWNER_AUTHORIZED_CHARACTER_REVIEWER_REFERENCE = "dsh-ai-owner-authorized-review";

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
      reviewerReference: `${OWNER_AUTHORIZED_CHARACTER_REVIEWER_REFERENCE}:language`,
      notes: "Owner-authorized AI language review for the personal Alpha; this is not a human native-speaker signature.",
      reviewedAt,
    },
    {
      locale: "zh-CN",
      reviewerReference: `${OWNER_AUTHORIZED_CHARACTER_REVIEWER_REFERENCE}:pedagogy`,
      notes: "Owner-authorized AI pedagogy-risk review for the personal Alpha; this is not a human teaching-expert signature.",
      reviewedAt,
    },
    {
      locale: "es-ES",
      reviewerReference: `${OWNER_AUTHORIZED_CHARACTER_REVIEWER_REFERENCE}:canon`,
      notes: "Owner-authorized AI canon, privacy, and character-boundary review for the personal Alpha.",
      reviewedAt,
    },
  ];
}

function publishableCandidate(source: CharacterBible, current: CharacterBible | null): CharacterBible {
  const candidate = { ...source, status: "published" as const };
  const result = canPublishCharacterRevision(current, candidate, { approvedReview: true });
  if (!result.ok) throw new CharacterPublishError("CHARACTER_REVIEW_INVALID");
  return candidate;
}

/**
 * The revision gate compares a candidate against the revision it supersedes, so
 * a version above 1 has to be given that revision. Passing null means "no
 * previous revision", which the gate only accepts for version 1.
 */
function parseCandidate(source: unknown, current: CharacterBible | null): CharacterBible {
  try {
    return publishableCandidate(validateCharacterBible(source), current);
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
  /** The revision this candidate supersedes, required above version 1. */
  current?: CharacterBible | null;
  reviewedAt?: Date;
}>): Promise<PublishCharacterResult> {
  const candidate = parseCandidate(input.source, input.current ?? null);
  const reviews = temporaryReviews(input.reviewedAt ?? new Date());
  return input.repository.transaction((repository) => publishPreparedCharacter(repository, candidate, reviews));
}

export async function publishCharacterBibles(input: Readonly<{
  repository: CharacterRepository;
  sources: readonly unknown[];
  /** Superseded revisions, positionally matched to `sources`. */
  currentRevisions?: readonly (CharacterBible | null)[];
  reviewedAt?: Date;
}>): Promise<readonly PublishCharacterResult[]> {
  const reviewedAt = input.reviewedAt ?? new Date();
  const prepared = input.sources.map((source, index) => ({
    candidate: parseCandidate(source, input.currentRevisions?.[index] ?? null),
    reviews: temporaryReviews(reviewedAt),
  }));
  return input.repository.transaction((repository) =>
    Promise.all(prepared.map(({ candidate, reviews }) => publishPreparedCharacter(repository, candidate, reviews))),
  );
}
