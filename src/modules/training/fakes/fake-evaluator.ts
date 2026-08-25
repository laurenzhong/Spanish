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
  // Bounded fake-rubric signals, not sentence matching. Natural alternatives
  // can complete the communicative purpose without copying the prompt.
  "start.como-va-todo": [
    /c[oó]mo\s+(va|te va)/i,
    /qu[eé]\s+tal/i,
    /\b(bien|mal|regular|genial|tranquil|ocupad|cansad|gracias|todo|trabajo|clase|d[ií]a|semana)\b/i,
  ],
  "relationship.como-se-llama": [
    /c[oó]mo\s+(se llama|te llamas)/i,
    /cu[aá]l es tu nombre/i,
    /\b(me llamo|soy)\b/i,
  ],
  "relationship.me-gusta-viajar": [
    /\b(me gusta|me encanta|disfruto|afici[oó]n|hobby)\b/i,
    /\b(viajar|viaje|m[uú]sica|cine|leer|senderismo|comida)\b/i,
  ],
  "need.necesito-ayuda": [
    /\b(necesito|ayuda|podr[ií]as|puede|por favor|problema)\b/i,
  ],
  "response.suena-bien": [
    /\b(suena bien|me parece bien|perfecto|genial|vale|de acuerdo|claro)\b/i,
  ],
  "repair.podria-repetirlo": [
    /podr[ií]a repetir/i,
    /puede repetir/i,
    /rep[ií]telo/i,
    /m[aá]s despacio/i,
    /no he entendido/i,
  ],
};

function baseExpressionKey(expressionKey: string): string {
  return expressionKey.split(".variant.", 1)[0] ?? expressionKey;
}

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
        (acceptedPatterns[baseExpressionKey(request.expressionKey)] ?? []).some((pattern) =>
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
