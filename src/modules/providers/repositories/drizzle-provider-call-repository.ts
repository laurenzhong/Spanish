import { type PgDatabase, type PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "@/src/shared/db/schema";
import type { ProviderCallObservation } from "@/src/shared/observability";

type ProviderCallDatabase<TResult extends PgQueryResultHKT> = PgDatabase<
  TResult,
  typeof schema
>;

export function createDrizzleProviderCallRepository<
  TResult extends PgQueryResultHKT,
>(database: ProviderCallDatabase<TResult>) {
  return {
    async record(input: ProviderCallObservation): Promise<void> {
      await database.insert(schema.providerCalls).values({
        userId: input.userId ?? null,
        providerType: input.providerType,
        provider: input.provider,
        modelVersion: input.modelVersion ?? null,
        providerRequestId: input.providerRequestId ?? null,
        status: input.status,
        latencyMs: input.latencyMs,
        estimatedCostMicros: input.estimatedCostMicros ?? null,
        confidence: input.confidenceBasisPoints ?? null,
        requestId: input.correlation.requestId,
        sessionId: input.correlation.sessionId ?? null,
        attemptId: input.correlation.attemptId ?? null,
        conversationId: input.correlation.conversationId ?? null,
        generationId: input.correlation.generationId ?? null,
        errorType: input.errorType ?? null,
        metadata: {},
        completedAt: new Date(),
      });
    },
  };
}
