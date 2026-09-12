import "server-only";

import type { ScenarioGenerationProvider } from "./scenario-generation";
import type { ScenarioRoleplayProvider } from "./scenario-roleplay";
import type { ScenarioEvaluationProvider } from "./scenario-evaluation";
import {
  recordProviderCallSafely,
  safeProviderErrorType,
  type ProviderCallObserver,
  type ProviderCallStatus,
} from "@/src/shared/observability";

export function observeScenarioGenerationProvider(
  provider: ScenarioGenerationProvider,
  observer: ProviderCallObserver | undefined,
  userId: string,
): ScenarioGenerationProvider {
  return {
    key: provider.key,
    async generate(input, options) {
      const startedAt = Date.now();
      try {
        const result = await provider.generate(input, options);
        await recordProviderCallSafely(observer, {
          userId,
          correlation: { requestId: input.requestId, generationId: input.generationId },
          providerType: "scenario-generation",
          provider: provider.key,
          modelVersion: result.modelVersion,
          providerRequestId: result.providerRequestId,
          status: "succeeded",
          latencyMs: result.latencyMs,
          estimatedCostMicros: result.estimatedCostMicros,
        });
        return result;
      } catch (error) {
        await recordFailure(observer, userId, "scenario-generation", provider.key, {
          requestId: input.requestId,
          generationId: input.generationId,
        }, Date.now() - startedAt, error);
        throw error;
      }
    },
  };
}

export function observeScenarioEvaluationProvider(
  provider: ScenarioEvaluationProvider,
  observer: ProviderCallObserver | undefined,
  userId: string,
): ScenarioEvaluationProvider {
  return {
    key: provider.key,
    async evaluate(input, options) {
      const startedAt = Date.now();
      try {
        const result = await provider.evaluate(input, options);
        await recordProviderCallSafely(observer, {
          userId,
          correlation: { requestId: input.requestId, sessionId: input.sessionId, generationId: input.generationId },
          providerType: "scenario-evaluation",
          provider: provider.key,
          modelVersion: result.modelVersion,
          providerRequestId: result.providerRequestId,
          status: "succeeded",
          latencyMs: result.latencyMs,
          estimatedCostMicros: result.estimatedCostMicros,
        });
        return result;
      } catch (error) {
        await recordFailure(observer, userId, "scenario-evaluation", provider.key, {
          requestId: input.requestId,
          sessionId: input.sessionId,
          generationId: input.generationId,
        }, Date.now() - startedAt, error);
        throw error;
      }
    },
  };
}

export function observeScenarioRoleplayProvider(
  provider: ScenarioRoleplayProvider,
  observer: ProviderCallObserver | undefined,
  userId: string,
): ScenarioRoleplayProvider {
  return {
    key: provider.key,
    modelVersion: provider.modelVersion,
    async *stream(input, options) {
      const startedAt = Date.now();
      let didFinish = false;
      try {
        for await (const event of provider.stream(input, options)) {
          if (event.type === "done") didFinish = true;
          yield event;
        }
        if (didFinish) {
          await recordProviderCallSafely(observer, {
            userId,
            correlation: { requestId: input.requestId, sessionId: input.sessionId, generationId: input.generationId },
            providerType: "scenario-roleplay",
            provider: provider.key,
            modelVersion: provider.modelVersion ?? null,
            providerRequestId: null,
            status: "succeeded",
            latencyMs: Date.now() - startedAt,
            estimatedCostMicros: null,
          });
        } else {
          await recordFailure(observer, userId, "scenario-roleplay", provider.key, {
            requestId: input.requestId,
            sessionId: input.sessionId,
            generationId: input.generationId,
          }, Date.now() - startedAt, { code: "SCENARIO_REPLY_INCOMPLETE" }, provider.modelVersion);
        }
      } catch (error) {
        await recordFailure(observer, userId, "scenario-roleplay", provider.key, {
          requestId: input.requestId,
          sessionId: input.sessionId,
          generationId: input.generationId,
        }, Date.now() - startedAt, error, provider.modelVersion);
        throw error;
      }
    },
  };
}

async function recordFailure(
  observer: ProviderCallObserver | undefined,
  userId: string,
  providerType: string,
  provider: string,
  correlation: Readonly<{ requestId: string; sessionId?: string; generationId?: string }>,
  latencyMs: number,
  error: unknown,
  modelVersion?: string,
) {
  const status: ProviderCallStatus = safeProviderErrorType(error) === "provider-cancelled"
    ? "cancelled"
    : "failed";
  await recordProviderCallSafely(observer, {
    userId,
    correlation,
    providerType,
    provider,
    modelVersion: modelVersion ?? null,
    providerRequestId: null,
    status,
    latencyMs,
    estimatedCostMicros: null,
    errorType: safeProviderErrorType(error),
  });
}
