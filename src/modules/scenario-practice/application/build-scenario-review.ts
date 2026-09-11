import type { ScenarioRepetitionItem, ScenarioTurn, ScenarioTurnReview } from "../domain";
import type { PersistedScenarioSession } from "../repositories";

export type ScenarioReviewTurn = ScenarioTurn & Readonly<{
  review: ScenarioTurnReview | Readonly<{
    status: "pending";
    communicationSuccess: null;
    errorSpans: readonly [];
    naturalAlternatives: readonly [];
  }> | null;
  marked: boolean;
}>;

export type ScenarioReviewDto = Readonly<{
  sessionId: string;
  scenarioKey: string | null;
  title: string;
  communicationGoal: string;
  characterName: string;
  completedAt: string | null;
  communication: Readonly<{ successful: number; needsWork: number; pending: number }>;
  turns: readonly ScenarioReviewTurn[];
  repetitions: readonly ScenarioRepetitionItem[];
  nextRepetition: ScenarioRepetitionItem | null;
}>;

export function buildScenarioReview(input: Readonly<{
  session: PersistedScenarioSession;
  turns: readonly ScenarioTurn[];
  reviews: readonly ScenarioTurnReview[];
  repetitions: readonly ScenarioRepetitionItem[];
}>): ScenarioReviewDto {
  const reviewByTurn = new Map(input.reviews.map((review) => [review.turnId, review]));
  const turns = input.turns
    .filter((turn) => turn.status === "completed")
    .toSorted((left, right) => left.turnIndex - right.turnIndex)
    .map((turn): ScenarioReviewTurn => {
      if (turn.speaker !== "user") return { ...turn, review: null, marked: false };
      const review = reviewByTurn.get(turn.id) ?? {
        status: "pending" as const,
        communicationSuccess: null,
        errorSpans: [] as const,
        naturalAlternatives: [] as const,
      };
      const marked = review.status === "ready" && (
        review.communicationSuccess === false ||
        review.errorSpans.length > 0 ||
        review.naturalAlternatives.length > 0
      );
      return { ...turn, review, marked };
    });
  const userReviews = turns.flatMap((turn) => turn.speaker === "user" && turn.review ? [turn.review] : []);
  const repetitions = [...input.repetitions].toSorted((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
  return {
    sessionId: input.session.sessionId,
    scenarioKey: input.session.scenarioKey,
    title: input.session.scenarioTitle ?? input.session.communicationGoal,
    communicationGoal: input.session.communicationGoal,
    characterName: input.session.temporaryCharacter.displayName,
    completedAt: input.session.completedAt?.toISOString() ?? null,
    communication: {
      successful: userReviews.filter((review) => review.status === "ready" && review.communicationSuccess === true).length,
      needsWork: userReviews.filter((review) => review.status === "ready" && review.communicationSuccess === false).length,
      pending: userReviews.filter((review) => review.status !== "ready").length,
    },
    turns,
    repetitions,
    nextRepetition: repetitions.find((item) => item.status === "pending") ?? null,
  };
}
