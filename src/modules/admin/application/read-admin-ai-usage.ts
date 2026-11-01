import { resolveAdminTimeRange } from "../domain/admin-console";
import type { AdminReadRepository } from "../repositories/admin-read-repository";
import type { AdminAiUsageDataDto } from "../schemas/admin-console";
import { toAiAggregate } from "./admin-projection";

export type ReadAdminAiUsageInput = Readonly<{
  from?: string;
  to?: string;
  providerType?: string;
  provider?: string;
  /** Injectable clock for deterministic tests and default range resolution. */
  now?: Date;
}>;

/**
 * AI usage and estimated cost for `/admin/ai-usage` (design §5.4).
 *
 * `from`/`to` are ISO timestamps produced by the query schema; when omitted the
 * window is the last 30 days. Ranges longer than 90 days are rejected upstream
 * by the same schema. Latency percentiles only cover succeeded calls and every
 * cost figure is paired with its coverage so a sparse ledger cannot be mistaken
 * for a complete bill.
 */
export async function readAdminAiUsage(
  repository: AdminReadRepository,
  input: ReadAdminAiUsageInput,
): Promise<AdminAiUsageDataDto> {
  const now = input.now ?? new Date();
  const range = resolveAdminTimeRange(
    {
      from: input.from ? new Date(input.from) : null,
      to: input.to ? new Date(input.to) : null,
    },
    now,
  );
  const record = await repository.readAiUsage({
    from: range.from,
    to: range.to,
    providerType: input.providerType,
    provider: input.provider,
  });
  return {
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    generatedAt: now.toISOString(),
    providerType: input.providerType ?? null,
    provider: input.provider ?? null,
    totals: toAiAggregate(record.totals),
    byProviderType: record.byProviderType.map((provider) => ({
      ...toAiAggregate(provider),
      providerType: provider.providerType,
    })),
    byProvider: record.byProvider.map((provider) => ({
      ...toAiAggregate(provider),
      provider: provider.provider,
      providerType: provider.providerType,
    })),
    byDay: record.byDay.map((day) => ({
      date: day.date,
      calls: day.calls,
      failed: day.failed,
      estimatedCostMicros: day.estimatedCostMicros,
      costUnknownCalls: day.costUnknownCalls,
    })),
    topErrorTypes: record.topErrorTypes.map((error) => ({
      errorType: error.errorType,
      count: error.count,
    })),
    safetyGate: {
      conversationBlockedGenerations:
        record.safetyGate.conversationBlockedGenerations,
      proactiveBlockedCandidates: record.safetyGate.proactiveBlockedCandidates,
    },
  };
}
