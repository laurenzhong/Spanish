import { shouldFallbackScenarioProvider } from "./scenario-provider-router";

type KeyedProvider = Readonly<{ key: string }>;
export type ProviderAttempt<TProvider, TResult = unknown> = Readonly<{
  provider: TProvider;
  status: "succeeded" | "failed" | "cancelled";
  latencyMs: number;
  result?: TResult;
  error?: unknown;
}>;

export async function executeWithScenarioProviderFallback<
  TProvider extends KeyedProvider,
  TResult,
>(input: Readonly<{
  providers: readonly TProvider[];
  execute: (provider: TProvider) => Promise<TResult>;
  onAttempt?: (attempt: ProviderAttempt<TProvider, TResult>) => Promise<void> | void;
  clock?: () => number;
}>): Promise<Readonly<{ provider: TProvider; result: TResult }>> {
  const providers = input.providers.slice(0, 2);
  if (!providers[0]) throw new Error("PROVIDER_NOT_CONFIGURED");
  let lastError: unknown;
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]!;
    const startedAt = (input.clock ?? Date.now)();
    try {
      const result = await input.execute(provider);
      await notifyAttempt(input.onAttempt, { provider, result, status: "succeeded", latencyMs: Math.max(0, (input.clock ?? Date.now)() - startedAt) });
      return { provider, result };
    } catch (error) {
      lastError = error;
      await notifyAttempt(input.onAttempt, { provider, error, status: isCancelled(error) ? "cancelled" : "failed", latencyMs: Math.max(0, (input.clock ?? Date.now)() - startedAt) });
      if (!providers[index + 1] || !shouldFallbackScenarioProvider(error, {
        attempts: index + 1,
        hasVisibleDelta: false,
      })) throw error;
    }
  }
  throw lastError;
}

export async function* streamWithScenarioProviderFallback<
  TProvider extends KeyedProvider,
  TEvent,
>(input: Readonly<{
  providers: readonly TProvider[];
  stream: (provider: TProvider) => AsyncIterable<TEvent>;
  isVisibleDelta?: (event: TEvent) => boolean;
  isTerminal?: (event: TEvent) => boolean;
  incompleteError?: () => unknown;
  onAttempt?: (attempt: ProviderAttempt<TProvider>) => Promise<void> | void;
  clock?: () => number;
}>): AsyncIterable<Readonly<{ provider: TProvider; event: TEvent }>> {
  const providers = input.providers.slice(0, 2);
  if (!providers[0]) throw new Error("PROVIDER_NOT_CONFIGURED");
  const isVisibleDelta = input.isVisibleDelta ?? defaultIsVisibleDelta;
  let lastError: unknown;
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index]!;
    let hasVisibleDelta = false;
    let hasTerminal = false;
    const startedAt = (input.clock ?? Date.now)();
    try {
      for await (const event of input.stream(provider)) {
        if (isVisibleDelta(event)) hasVisibleDelta = true;
        if (input.isTerminal?.(event)) hasTerminal = true;
        yield { provider, event };
      }
      if (input.isTerminal && !hasTerminal) {
        throw input.incompleteError?.() ?? new Error("PROVIDER_STREAM_INCOMPLETE");
      }
      await notifyAttempt(input.onAttempt, { provider, status: "succeeded", latencyMs: Math.max(0, (input.clock ?? Date.now)() - startedAt) });
      return;
    } catch (error) {
      lastError = error;
      await notifyAttempt(input.onAttempt, { provider, error, status: isCancelled(error) ? "cancelled" : "failed", latencyMs: Math.max(0, (input.clock ?? Date.now)() - startedAt) });
      if (!providers[index + 1] || !shouldFallbackScenarioProvider(error, {
        attempts: index + 1,
        hasVisibleDelta,
      })) throw error;
    }
  }
  throw lastError;
}

async function notifyAttempt<TProvider, TResult>(
  callback: ((attempt: ProviderAttempt<TProvider, TResult>) => Promise<void> | void) | undefined,
  attempt: ProviderAttempt<TProvider, TResult>,
) {
  try { await callback?.(attempt); } catch { /* Observability cannot change provider outcomes. */ }
}

function isCancelled(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: unknown }).code === "provider-cancelled";
}

function defaultIsVisibleDelta(event: unknown): boolean {
  return typeof event === "object" && event !== null &&
    "type" in event && (event as { type?: unknown }).type === "delta";
}
