import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  explain: vi.fn(),
  explainStream: undefined as unknown,
}));

vi.mock("@/src/shared/auth/server", () => ({
  verifyRequestUser: mocks.verifyRequestUser,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock("@/src/modules/providers/word-explanation/server", () => ({
  createMiniMaxWordExplanationProvider: () => ({ explain: mocks.explain, explainStream: mocks.explainStream }),
  WordExplanationError: class WordExplanationError extends Error {
    code: string;
    retryable: boolean;
    constructor(code: string, message: string, retryable: boolean) {
      super(message);
      this.code = code;
      this.retryable = retryable;
    }
  },
}));

import { POST } from "@/app/api/v1/read/word-explanation/route";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function request(body: unknown, init: { headers?: HeadersInit } = {}) {
  return new NextRequest("http://localhost/api/v1/read/word-explanation", {
    ...init,
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "word_12345678", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

describe("word explanation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.explainStream = undefined;
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.explain.mockResolvedValue({
      partOfSpeech: "名词",
      meaning: "咖啡",
      contextualMeaning: "这里指咖啡馆。",
      example: "Nos vemos en el café.",
      provider: "minimax",
      modelVersion: "MiniMax-M3",
      providerRequestId: "request-1",
      latencyMs: 20,
      estimatedCostMicros: null,
    });
  });

  it("requires a session and validates input before calling MiniMax", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const unauthorized = await POST(request({ word: "café", context: "Nos vemos en el café.", locale: "es-ES" }));
    expect(unauthorized.status).toBe(401);

    mocks.verifyRequestUser.mockResolvedValue(user);
    const invalid = await POST(request({ word: "", context: "", locale: "es-ES" }));
    expect(invalid.status).toBe(400);
    expect(mocks.explain).not.toHaveBeenCalled();
  });

  it("returns the validated MiniMax explanation with the request id", async () => {
    const response = await POST(request({ word: "café", context: "Nos vemos en el café.", locale: "es-ES" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("word_12345678");
    await expect(response.json()).resolves.toMatchObject({ apiVersion: "v1", data: { modelVersion: "MiniMax-M3", contextualMeaning: "这里指咖啡馆。" } });
    expect(mocks.explain).toHaveBeenCalledWith(
      { word: "café", context: "Nos vemos en el café.", locale: "es-ES", selectionType: "word" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns NDJSON deltas and a done event when the provider streams", async () => {
    mocks.explainStream = async function* () {
      yield { type: "delta", text: '{"meaning":"咖' } as const;
      yield { type: "delta", text: '啡"}' } as const;
      yield { type: "done", explanation: { meaning: "咖啡" } } as const;
    };
    const response = await POST(request({ word: "café", context: "Nos vemos en el café.", locale: "es-ES" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line) as { type?: string });
    expect(lines.map((line) => line.type)).toEqual(["delta", "delta", "done"]);
    expect(mocks.explain).not.toHaveBeenCalled();
  });
});
