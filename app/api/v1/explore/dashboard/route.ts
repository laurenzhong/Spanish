import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getExploreDashboardForUser, getExploreLibraryForUser } from "@/src/modules/explore";
import { BundleExploreRepository, CatalogExploreLibraryRepository, createDrizzleExploreUserStateRepository, emptyExploreUserStateRepository } from "@/src/modules/explore/repositories";
import { createDrizzleScenarioLibraryRepository } from "@/src/modules/scenario-practice";
import { getCurrentUser, verifyRequestUser } from "@/src/shared/auth/server";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";
import { getDatabase } from "@/src/shared/db/client";

const repository = new BundleExploreRepository();

function errorResponse(requestId: string, code: string, status: number, message: string, retryable: boolean) {
  return NextResponse.json(
    { apiVersion: API_VERSION, error: { code, message, requestId, retryable } },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const user = (await verifyRequestUser(request)) ?? (await getCurrentUser());
  if (!user) return errorResponse(requestId, "AUTH_REQUIRED", 401, "需要有效的用户会话。", false);

  try {
    const database = process.env.DATABASE_URL ? getDatabase() : null;
    const userStateRepository = database ? createDrizzleExploreUserStateRepository(database) : emptyExploreUserStateRepository;
    const [dashboard, library] = await Promise.all([
      getExploreDashboardForUser(repository, userStateRepository, user.id),
      getExploreLibraryForUser(
        new CatalogExploreLibraryRepository(database ? createDrizzleScenarioLibraryRepository(database) : undefined),
        user.id,
        { allowDraft: process.env.NODE_ENV !== "production" },
      ),
    ]);
    const data = { ...dashboard, library };
    return NextResponse.json(
      { apiVersion: API_VERSION, data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    return errorResponse(requestId, "EXPLORE_DASHBOARD_UNAVAILABLE", 503, "探索内容暂时不可用，请稍后重试。", true);
  }
}
