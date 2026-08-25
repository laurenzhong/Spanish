import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  aggregateDiagnosticAlerts,
  createDrizzleDiagnosticEventRepository,
} from "@/src/modules/observability";
import {
  diagnosticEventStatuses,
  diagnosticEventTypes,
} from "@/src/shared/observability";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const querySchema = z.object({
  eventType: z.enum(diagnosticEventTypes).optional(),
  severity: z.enum(["warning", "alert"]).optional(),
  status: z.enum(diagnosticEventStatuses).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function unauthorized(requestId: string): NextResponse {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code: "AUTH_REQUIRED", requestId, retryable: false } },
    { status: 401 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const configuredToken = process.env.DIAGNOSTICS_INTERNAL_TOKEN?.trim();
  const suppliedToken = request.headers.get("x-diagnostics-token")?.trim();
  if (!configuredToken || !suppliedToken || suppliedToken !== configuredToken) {
    return unauthorized(requestId);
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { apiVersion: API_VERSION, error: { code: "INTERNAL_ERROR", requestId, retryable: true } },
      { status: 503 },
    );
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { apiVersion: API_VERSION, error: { code: "VALIDATION_FAILED", requestId, retryable: false } },
      { status: 400 },
    );
  }

  try {
    const events = await createDrizzleDiagnosticEventRepository(getDatabase()).list({
      eventType: parsed.data.eventType,
      severity: parsed.data.severity,
      status: parsed.data.status,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      limit: parsed.data.limit,
    });
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        data: {
          events,
          alerts: aggregateDiagnosticAlerts(events),
        },
      },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    return NextResponse.json(
      { apiVersion: API_VERSION, error: { code: "INTERNAL_ERROR", requestId, retryable: true } },
      { status: 503 },
    );
  }
}
