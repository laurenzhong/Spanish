// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), verifyRequestUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/src/shared/auth/server", () => ({ getCurrentUser: mocks.getCurrentUser, verifyRequestUser: mocks.verifyRequestUser }));

import { handleSavedExpressions } from "@/app/api/v1/expressions/saved/route";

describe("saved expression route", () => {
  beforeEach(() => {
    mocks.verifyRequestUser.mockResolvedValue({ id: "00000000-0000-4000-8000-000000000902" });
    mocks.getCurrentUser.mockResolvedValue(null);
  });

  it("lists and idempotently saves an expression without creating learning evidence", async () => {
    const saved = { id: "20000000-0000-4000-8000-000000000902", sourceText: "Quisiera un café.", translation: "我想要一杯咖啡。", sourceType: "manual" as const, sourceEntityId: null, sourceVersion: null, createdAt: "2026-09-11T00:00:00.000Z" };
    const repository = {
      listSavedExpressions: vi.fn(async () => [saved]),
      resolveSavedExpressionSource: vi.fn(async () => ({ sourceText: saved.sourceText, translation: saved.translation, register: null, usageNotes: null, sourceType: saved.sourceType, sourceEntityId: null, sourceVersion: null, expressionId: null, contentHash: null })),
      findSavedExpressionByClientSaveId: vi.fn(async () => null),
      createSavedExpression: vi.fn(async () => saved),
    };
    const post = await handleSavedExpressions(new NextRequest("http://localhost/api/v1/expressions/saved", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSaveId: "save-manual-1", source: { sourceType: "manual", text: "Quisiera un café.", translation: "我想要一杯咖啡。" } }),
    }), repository as never);
    expect(post.status).toBe(201);
    expect(post.headers.get("cache-control")).toBe("private, no-store");
    expect(repository.createSavedExpression).toHaveBeenCalledWith(expect.objectContaining({ userId: "00000000-0000-4000-8000-000000000902" }));

    const get = await handleSavedExpressions(new NextRequest("http://localhost/api/v1/expressions/saved"), repository as never);
    await expect(get.json()).resolves.toMatchObject({ data: { expressions: [saved] } });
  });

  it("rejects forged authoritative text alongside a formal source reference", async () => {
    const response = await handleSavedExpressions(new NextRequest("http://localhost/api/v1/expressions/saved", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSaveId: "save-forged-1", source: { sourceType: "formal-expression", expressionKey: "expression.request", version: 1, text: "forged" } }),
    }), {} as never);
    expect(response.status).toBe(400);
  });
});
