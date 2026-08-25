import type { DiagnosticEventRecord, DiagnosticEventType } from "@/src/shared/observability";

export type DiagnosticAlert = Readonly<{
  eventType: DiagnosticEventType;
  errorType: string | null;
  count: number;
  threshold: number;
  windowMinutes: number;
  severity: "warning" | "alert";
  firstOccurredAt: Date;
  lastOccurredAt: Date;
}>;

const rules: Readonly<Record<DiagnosticEventType, { threshold: number; windowMinutes: number }>> = {
  "conversation.stream_failed": { threshold: 3, windowMinutes: 15 },
  "evidence.duplicate": { threshold: 5, windowMinutes: 60 },
  "memory.conflict": { threshold: 3, windowMinutes: 60 },
  "privacy.storage_cleanup_failed": { threshold: 1, windowMinutes: 15 },
};

export function aggregateDiagnosticAlerts(
  events: readonly DiagnosticEventRecord[],
  now = new Date(),
): readonly DiagnosticAlert[] {
  const alerts: DiagnosticAlert[] = [];
  for (const [eventType, rule] of Object.entries(rules) as Array<[DiagnosticEventType, (typeof rules)[DiagnosticEventType]]>) {
    const cutoff = now.getTime() - rule.windowMinutes * 60_000;
    const matching = events
      .filter((event) => event.eventType === eventType && event.occurredAt.getTime() >= cutoff)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    if (matching.length === 0) continue;
    const groups = new Map<string, DiagnosticEventRecord[]>();
    for (const event of matching) {
      const key = event.errorType ?? "unknown";
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }
    for (const [errorType, group] of groups) {
      alerts.push({
        eventType,
        errorType: errorType === "unknown" ? null : errorType,
        count: group.length,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        severity: group.length >= rule.threshold ? "alert" : "warning",
        firstOccurredAt: group[0]!.occurredAt,
        lastOccurredAt: group[group.length - 1]!.occurredAt,
      });
    }
  }
  return alerts.sort((a, b) => b.lastOccurredAt.getTime() - a.lastOccurredAt.getTime());
}
