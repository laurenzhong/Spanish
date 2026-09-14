export type ContentPipelineStep = "discover" | "process" | "cleanup" | "report";
export type ContentPipelineStatus = "started" | "succeeded" | "failed" | "skipped";

export type ContentPipelineObservation = Readonly<{
  runId: string;
  sourceStableKey?: string;
  step: ContentPipelineStep;
  status: ContentPipelineStatus;
  durationMs: number;
  counts?: Readonly<Record<string, number>>;
  estimatedCostMicros?: number;
  errorCode?: string;
}>;

export type ContentPipelineObserver = Readonly<{
  record(observation: ContentPipelineObservation): Promise<void> | void;
}>;

export function sanitizePipelineObservation(
  observation: ContentPipelineObservation,
): ContentPipelineObservation {
  const safeKey = observation.sourceStableKey && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(observation.sourceStableKey)
    ? observation.sourceStableKey
    : undefined;
  const counts = Object.fromEntries(
    Object.entries(observation.counts ?? {})
      .filter(([key, value]) => /^[A-Za-z0-9_.-]{1,64}$/u.test(key) && Number.isSafeInteger(value) && value >= 0)
      .map(([key, value]) => [key, value]),
  );
  return {
    runId: /^[A-Za-z0-9_-]{8,128}$/u.test(observation.runId) ? observation.runId : "redacted-run",
    ...(safeKey ? { sourceStableKey: safeKey } : {}),
    step: observation.step,
    status: observation.status,
    durationMs: Number.isFinite(observation.durationMs) ? Math.max(0, Math.round(observation.durationMs)) : 0,
    counts,
    ...(observation.estimatedCostMicros !== undefined && Number.isSafeInteger(observation.estimatedCostMicros) && observation.estimatedCostMicros >= 0
      ? { estimatedCostMicros: observation.estimatedCostMicros }
      : {}),
    ...(observation.errorCode && /^[A-Za-z0-9._-]{1,96}$/u.test(observation.errorCode)
      ? { errorCode: observation.errorCode }
      : {}),
  };
}

export function formatPipelineObservation(observation: ContentPipelineObservation): string {
  return JSON.stringify(sanitizePipelineObservation(observation));
}

export async function recordPipelineObservationSafely(
  observer: ContentPipelineObserver | undefined,
  observation: ContentPipelineObservation,
): Promise<void> {
  if (!observer) return;
  try {
    await observer.record(sanitizePipelineObservation(observation));
  } catch {
    // Observability must not change the pipeline result.
  }
}
