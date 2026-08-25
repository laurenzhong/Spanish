import { randomUUID } from "node:crypto";

export type CorrelationIds = Readonly<{
  requestId: string;
  sessionId?: string;
  attemptId?: string;
  conversationId?: string;
  generationId?: string;
}>;

export type ProviderCallStatus = "started" | "succeeded" | "failed" | "cancelled";

export type ProviderCallObservation = Readonly<{
  userId?: string;
  correlation: CorrelationIds;
  providerType: string;
  provider: string;
  modelVersion?: string | null;
  providerRequestId?: string | null;
  status: ProviderCallStatus;
  latencyMs: number;
  estimatedCostMicros?: number | null;
  confidenceBasisPoints?: number | null;
  errorType?: string | null;
}>;

export type ProviderCallObserver = Readonly<{
  record(input: ProviderCallObservation): Promise<void>;
}>;

const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/u;

export function createCorrelationIds(
  input: Partial<Omit<CorrelationIds, "requestId">> & { requestId?: string } = {},
): CorrelationIds {
  const requestId = input.requestId?.trim() || randomUUID();
  if (!requestIdPattern.test(requestId)) {
    throw new Error("requestId has an invalid format.");
  }
  return {
    requestId,
    ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
    ...(input.attemptId?.trim() ? { attemptId: input.attemptId.trim() } : {}),
    ...(input.conversationId?.trim() ? { conversationId: input.conversationId.trim() } : {}),
    ...(input.generationId?.trim() ? { generationId: input.generationId.trim() } : {}),
  };
}

export function safeProviderErrorType(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9._-]{1,96}$/u.test(code)) return code;
  }
  return "unknown-error";
}

export function clampLatencyMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export async function recordProviderCallSafely(
  observer: ProviderCallObserver | undefined,
  input: ProviderCallObservation,
): Promise<void> {
  if (!observer) return;
  try {
    await observer.record({ ...input, latencyMs: clampLatencyMs(input.latencyMs) });
  } catch {
    // Observability must never change the user-visible provider result.
  }
}
