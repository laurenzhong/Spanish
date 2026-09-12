import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  buildScenarioReview,
  ScenarioReview,
  type PersistedScenarioSession,
  type ScenarioRepetitionItem,
  type ScenarioTurn,
  type ScenarioTurnReview,
} from "@/src/modules/scenario-practice";

const session: PersistedScenarioSession = {
  sessionId: "10000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000001",
  clientAttemptId: "session-attempt",
  personalScenarioId: null,
  scenarioId: "20000000-0000-4000-8000-000000000001",
  scenarioKey: "scenario.campus-administration",
  scenarioTitle: "校园办事",
  primaryModality: "speech",
  contentVersion: 1,
  status: "completed",
  revision: 4,
  currentTurn: 3,
  hintLevel: 0,
  generationId: null,
  communicationGoal: "说明需求并确认材料",
  temporaryCharacter: { displayName: "Javier", role: "办事员", locale: "es-ES" },
  reviewStatus: "pending",
  completionIdempotencyKey: "complete-1",
  completedAt: new Date("2026-09-11T10:00:00.000Z"),
};

const turns: readonly ScenarioTurn[] = [
  { id: "turn-1", sessionId: session.sessionId, userId: session.userId, turnIndex: 0, speaker: "user", modality: "speech", text: "Necesito renovar mi tarjeta.", status: "completed", attemptId: "attempt-1", generationId: "generation-1" },
  { id: "turn-2", sessionId: session.sessionId, userId: session.userId, turnIndex: 1, speaker: "temporary-character", modality: "system", text: "¿Tiene el formulario?", status: "completed", attemptId: null, generationId: "generation-1" },
  { id: "turn-3", sessionId: session.sessionId, userId: session.userId, turnIndex: 2, speaker: "user", modality: "speech", text: "No tengo formulario.", status: "completed", attemptId: "attempt-2", generationId: "generation-2" },
  { id: "turn-pending", sessionId: session.sessionId, userId: session.userId, turnIndex: 3, speaker: "user", modality: "speech", text: "draft", status: "pending", attemptId: null, generationId: null },
];

const reviews: readonly ScenarioTurnReview[] = [
  { id: "review-1", turnId: "turn-1", userId: session.userId, communicationSuccess: true, errorSpans: [], naturalAlternatives: [], hintLevel: 0, transcriptConfidence: 0.91, status: "ready" },
  { id: "review-2", turnId: "turn-3", userId: session.userId, communicationSuccess: false, errorSpans: [{ start: 3, end: 8, explanation: "缺少冠词。", affectsUnderstanding: false }], naturalAlternatives: ["No tengo el formulario."], hintLevel: 1, transcriptConfidence: 0.88, status: "ready" },
];

const repetitions: readonly ScenarioRepetitionItem[] = [{
  id: "repetition-0", userId: session.userId, sourceSessionId: session.sessionId,
  intervalStep: 0, intervalDays: 0, dueAt: new Date("2026-09-11T10:00:00.000Z"), status: "pending",
  expressionSnapshot: ["No tengo el formulario."], goalSnapshot: session.communicationGoal,
  variantRequirements: [{ kind: "condition" }], idempotencyKey: "complete-1:0",
  completionKey: null, completedAt: null, result: null,
}];

describe("scenario review", () => {
  it("keeps completed turns in order and leaves missing feedback neutral", () => {
    const result = buildScenarioReview({ session, turns, reviews, repetitions });

    expect(result.turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2", "turn-3"]);
    expect(result.communication).toEqual({ successful: 1, needsWork: 1, pending: 0 });
    expect(result.turns[2]).toMatchObject({
      review: { status: "ready", naturalAlternatives: ["No tengo el formulario."] },
    });
    expect(result.nextRepetition?.id).toBe("repetition-0");
  });

  it("keeps the transcript visible and folds secondary review actions", () => {
    render(<ScenarioReview review={buildScenarioReview({ session, turns, reviews, repetitions })} />);

    const sections = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(sections).toEqual(["沟通结果", "完整对话"]);
    for (const label of ["错误详情", "自然替代表达", "重新说", "复现计划"]) {
      const summary = screen.getByText(label);
      expect(summary.closest("details")).not.toHaveAttribute("open");
    }
    fireEvent.click(screen.getByRole("button", { name: "只看标记" }));
    expect(screen.queryByText("Necesito renovar mi tarjeta.")).not.toBeInTheDocument();
    expect(screen.getByText("No tengo formulario.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "重新说这一句" })).toHaveAttribute("href", expect.stringContaining("retryTurnId=turn-3"));
  });
});
