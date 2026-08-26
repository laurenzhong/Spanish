import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getArticle } from "@/src/modules/content/application";
import { BundleArticleRepository } from "@/src/modules/content/repositories";
import { API_VERSION } from "@/src/shared/contracts/v1/api-contract";

const repository = new BundleArticleRepository();

type RouteContext = Readonly<{ params: Promise<{ articleId: string }> }>;

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const { articleId } = await params;
  const result = await getArticle(repository, decodeURIComponent(articleId));
  if (result.reason !== "found" || !result.article) {
    return NextResponse.json({ apiVersion: API_VERSION, error: { code: result.reason === "unpublished" ? "CONTENT_NOT_AVAILABLE" : "NOT_FOUND", message: "这篇文章暂时无法阅读。", retryable: result.reason === "unpublished", requestId } }, { status: result.reason === "unpublished" ? 404 : 404 });
  }
  return NextResponse.json({ apiVersion: API_VERSION, data: result.article });
}
