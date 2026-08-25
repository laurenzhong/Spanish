import type {
  DiagnosticEventRecord,
  DiagnosticEventStatus,
  DiagnosticEventType,
  DiagnosticEventWriter,
} from "@/src/shared/observability";

export type DiagnosticEventFilters = Readonly<{
  eventType?: DiagnosticEventType;
  status?: DiagnosticEventStatus;
  severity?: "warning" | "alert";
  since?: Date;
  limit?: number;
}>;

export type DiagnosticEventRepository = DiagnosticEventWriter & Readonly<{
  list(filters?: DiagnosticEventFilters): Promise<readonly DiagnosticEventRecord[]>;
}>;
