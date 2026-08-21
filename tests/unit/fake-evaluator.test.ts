import { describe, expect, it } from "vitest";

import { createFakeEvaluator } from "@/src/modules/training/fakes";

describe("fake evaluator", () => {
  it("accepts a natural alternative without requiring the reference sentence", async () => {
    const result = await createFakeEvaluator(0).evaluate({
      expressionKey: "start.como-va-todo",
      generationId: 1,
      outputMode: "speech",
      text: "¿Qué tal todo?",
    });

    expect(result.contextualSuccess).toBe(true);
    expect(result.evidenceStrength).toBe("strong");
    expect(result.feedbackKey).toBe("contextual-success");
  });

  it("keeps typed output at weak evidence even when the task succeeds", async () => {
    const result = await createFakeEvaluator(0).evaluate({
      expressionKey: "relationship.me-gusta-viajar",
      generationId: 2,
      outputMode: "typing",
      text: "Me encanta viajar.",
    });

    expect(result.contextualSuccess).toBe(true);
    expect(result.evidenceStrength).toBe("weak");
  });

  it("does not produce positive evidence for an empty or unrelated output", async () => {
    const evaluator = createFakeEvaluator(0);
    const empty = await evaluator.evaluate({
      expressionKey: "need.necesito-ayuda",
      generationId: 3,
      outputMode: "speech",
      text: "   ",
    });
    const unrelated = await evaluator.evaluate({
      expressionKey: "need.necesito-ayuda",
      generationId: 4,
      outputMode: "speech",
      text: "Me gusta el verano.",
    });

    expect(empty.contextualSuccess).toBe(false);
    expect(empty.evidenceStrength).toBe("weak");
    expect(unrelated.contextualSuccess).toBe(false);
    expect(unrelated.evidenceStrength).toBe("weak");
  });

  it("cancels an in-flight evaluation", async () => {
    const controller = new AbortController();
    const pending = createFakeEvaluator(100).evaluate(
      {
        expressionKey: "start.como-va-todo",
        generationId: 5,
        outputMode: "speech",
        text: "¿Cómo va todo?",
      },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
