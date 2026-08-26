import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { getArticles } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";

const repository = new BundleArticleRepository();

function first(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

export async function GET(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const params = request.nextUrl.searchParams;
  const pageSizeValue = Number.parseInt(params.get("pageSize") ?? "12", 10);
  const pageSize = Number.isFinite(pageSizeValue) ? pageSizeValue : 12;
  try {
    const result = await getArticles(repository, {
      search: first(params.get("search")),
      topic: first(params.get("topic")),
      cursor: first(params.get("cursor")),
      savedOnly: params.get("saved") === "1",
      pageSize,
    });
    return NextResponse.json({
      apiVersion: API_VERSION,
      data: {
        articles: result.articles,
        topics: result.topics,
        savedFilterAvailable: result.savedFilterAvailable,
      },
      page: { nextCursor: result.nextCursor, hasMore: result.hasMore },
    });
  } catch {
    return NextResponse.json(
      {
        apiVersion: API_VERSION,
        error: {
          code: "INTERNAL_ERROR",
          message: "阅读内容暂时不可用。",
          retryable: true,
          requestId,
        },
      },
      { status: 503 },
    );
  }
}
