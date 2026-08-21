import type { TrainingEvent } from "../domain/training-event";
import type { TrainingOutputMode } from "../domain/training-state";

export type FakeEvaluationRequest = Readonly<{
  expressionKey: string;
  generationId: number;
  outputMode: TrainingOutputMode;
  text: string;
}>;

export type FakeEvaluator = Readonly<{
  evaluate(
    request: FakeEvaluationRequest,
    signal?: AbortSignal,
  ): Promise<Extract<TrainingEvent, { type: "evaluation-succeeded" }>>;
}>;

const acceptedPatterns: Record<string, readonly RegExp[]> = {
  "start.como-va-todo": [/cómo va/i, /que tal/i, /qué tal/i, /cómo te va/i],
  "relationship.como-se-llama": [/cómo se llama/i, /cómo te llamas/i, /cual es tu nombre/i, /cuál es tu nombre/i],
  "relationship.me-gusta-viajar": [/me gusta/i, /me encanta/i],
  "need.necesito-ayuda": [/necesito/i, /puede ayudar/i],
  "response.suena-bien": [/suena bien/i, /me parece bien/i, /perfecto/i, /genial/i],
  "repair.podria-repetirlo": [/podría repetir/i, /puede repetir/i, /repítelo/i],
};

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Evaluation cancelled.", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        globalThis.clearTimeout(timer);
        reject(new DOMException("Evaluation cancelled.", "AbortError"));
      },
      { once: true },
    );
  });
}

export function createFakeEvaluator(latencyMs = 160): FakeEvaluator {
  return {
    async evaluate(request, signal) {
      await delay(latencyMs, signal);
      const text = request.text.trim();
      const accepted =
        text.length > 0 &&
        (acceptedPatterns[request.expressionKey] ?? []).some((pattern) =>
          pattern.test(text),
        );

      return {
        type: "evaluation-succeeded",
        generationId: request.generationId,
        contextualSuccess: accepted,
        evidenceStrength: accepted
          ? request.outputMode === "typing"
            ? "weak"
            : "strong"
          : "weak",
        feedbackKey: accepted ? "contextual-success" : "needs-another-attempt",
      };
    },
  };
}
