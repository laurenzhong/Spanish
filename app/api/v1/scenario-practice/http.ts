import { NextResponse } from "next/server";

import type { ApiErrorCode } from "@/src/shared/contracts/v1/api-contract";

export function scenarioData<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ apiVersion: "v1", data }, init);
}

export function scenarioError(request: Request, code: ApiErrorCode, message: string, status: number, retryable = false) {
  return NextResponse.json({ apiVersion: "v1", error: { code, message, retryable, requestId: request.headers.get("x-request-id") ?? crypto.randomUUID() } }, { status });
}
