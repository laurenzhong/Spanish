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

export const diagnosticEventTypes = [
  "conversation.stream_failed",
  "evidence.duplicate",
  "memory.conflict",
  "privacy.storage_cleanup_failed",
] as const;
export type DiagnosticEventType = (typeof diagnosticEventTypes)[number];

export const diagnosticSeverities = ["warning", "alert"] as const;
export type DiagnosticSeverity = (typeof diagnosticSeverities)[number];
export const diagnosticEventStatuses = ["open", "acknowledged", "resolved"] as const;
export type DiagnosticEventStatus = (typeof diagnosticEventStatuses)[number];

export type DiagnosticEventInput = Readonly<{
  userId?: string;
  eventType: DiagnosticEventType;
  severity: DiagnosticSeverity;
  dedupeKey: string;
  correlation?: Partial<CorrelationIds>;
  errorType?: string | null;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type DiagnosticEventRecord = Readonly<{
  id: string;
  eventType: DiagnosticEventType;
  severity: DiagnosticSeverity;
  status: DiagnosticEventStatus;
  requestId: string | null;
  sessionId: string | null;
  attemptId: string | null;
  conversationId: string | null;
  generationId: string | null;
  errorType: string | null;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: Date;
}>;

export type DiagnosticEventWriter = Readonly<{
  record(input: DiagnosticEventInput): Promise<void>;
}>;

export async function recordDiagnosticEventSafely(
  writer: DiagnosticEventWriter | undefined,
  input: DiagnosticEventInput,
): Promise<void> {
  if (!writer) return;
  try {
    await writer.record(input);
  } catch {
    // Diagnostics must never change the business outcome they describe.
  }
}

export function sanitizeDiagnosticMetadata(
  input: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/u.test(key)) continue;
    if (value === null || typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "string" && value.length <= 240) result[key] = value;
  }
  return result;
}

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
