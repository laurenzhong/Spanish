/**
 * Smoke test for the REAL MiniMax annotation-draft provider.
 *
 * Sends one synthetic learner transcript plus aggregate signal metadata — no
 * audio, no user data, nothing retained. Read-only: writes nothing.
 *
 * Run like the other provider scripts, because api.minimaxi.com is not
 * reachable directly from this machine:
 *
 *   HTTPS_PROXY=http://127.0.0.1:7897 node --use-env-proxy \
 *     --conditions=react-server --import tsx/esm scripts/smoke-annotation-draft.ts
 */
import { config as loadDotEnv } from "dotenv";

import { createMiniMaxAnnotationDraftProvider } from "../src/modules/providers/annotation/server";
import { AnnotationDraftError } from "../src/modules/providers/annotation";

loadDotEnv({ quiet: true });

const provider = createMiniMaxAnnotationDraftProvider();

console.log("api key present:", Boolean(process.env.MINIMAX_API_KEY?.trim()));
console.log("MINIMAX_API_ENDPOINT:", process.env.MINIMAX_API_ENDPOINT ?? "(unset)");

try {
  const started = Date.now();
  const draft = await provider.createDraft({
    transcript: "Ayer yo... yo fui al mercado y compré... eh, compré tomates y pan.",
    locale: "es-ES",
    contentVersion: "smoke-annotation-001",
    attemptId: "smoke-attempt-001",
    generationId: 1,
    speechSignal: null,
  });
  console.log("elapsed ms:", Date.now() - started);
  console.log("provider:", draft.provider, "| model:", draft.modelVersion);
  console.log("request id:", draft.providerRequestId);
  console.log("summary:", draft.summary.slice(0, 200));
  console.log("observations:", draft.observations.length);
  console.log("questions for reviewer:", draft.questionsForReviewer.length);
  console.log("safety:", JSON.stringify(draft.safety));
} catch (error) {
  if (error instanceof AnnotationDraftError) {
    console.log("AnnotationDraftError:", error.code, "| retryable:", error.retryable, "|", error.message);
  } else {
    console.log("unexpected error:", error);
  }
  process.exitCode = 1;
}
