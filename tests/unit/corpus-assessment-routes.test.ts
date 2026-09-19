import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyRequestUser: vi.fn(),
  getCurrentUser: vi.fn(),
  createRepository: vi.fn(),
  getDatabase: vi.fn(),
  repository: { searchCorpus: vi.fn(), getAssessment: vi.fn(), submitAssessment: vi.fn() },
}));

vi.mock("@/src/shared/auth/server", () => ({ verifyRequestUser: mocks.verifyRequestUser, getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/src/shared/db/client", () => ({ getDatabase: mocks.getDatabase }));
vi.mock("@/src/modules/lexicon-corpus/repositories", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/src/modules/lexicon-corpus/repositories")>();
  return { ...original, createDrizzleLexiconCorpusRepository: mocks.createRepository };
});

import { GET as search } from "@/app/api/v1/corpus/search/route";
import { GET as getAssessment, POST as postAssessment } from "@/app/api/v1/lexicon/assessments/[assessmentId]/route";
import { LexicalAssessmentConflictError, LexicalAssessmentNotFoundError } from "@/src/modules/lexicon-corpus/repositories";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const previousDatabaseUrl = process.env.DATABASE_URL;

function request(url: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(url, { ...init, headers: { "x-request-id": "corpus_12345678", ...(init.headers ?? {}) } });
}

describe("corpus and lexical assessment routes", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://test.invalid/db";
    vi.clearAllMocks();
    mocks.verifyRequestUser.mockResolvedValue(user);
    mocks.getCurrentUser.mockResolvedValue(null);
    mocks.createRepository.mockReturnValue(mocks.repository);
    mocks.getDatabase.mockReturnValue({});
    mocks.repository.searchCorpus.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    mocks.repository.getAssessment.mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001", assessmentKey: "lexical.core", version: 2, entryKind: "lexeme", entryId: null, promptType: "recall", prompt: "说出对应词语", options: [], acceptedAnswers: ["comer"], sourceReference: { stableKey: "article.one" }, skillKey: "lexical.vocabulary", contentVersion: 1 });
    mocks.repository.submitAssessment.mockResolvedValue({ attemptId: "20000000-0000-4000-8000-000000000001", assessmentKey: "lexical.core", version: 2, answer: "comer", passed: true, score: 1, normalizedAnswer: "comer", duplicate: false, evidence: "recorded" });
  });

  afterEach(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("validates and forwards public corpus searches", async () => {
    const response = await search(request("http://localhost/api/v1/corpus/search?query=café%20con%20leche&documentKind=media&pageSize=10"));
    expect(response.status).toBe(200);
    expect(mocks.repository.searchCorpus).toHaveBeenCalledWith(user.id, { query: "café con leche", documentKind: "media", page: 1, pageSize: 10 });
  });

  it("loads context for one exact lexicon entry without requiring free-text search", async () => {
    const entryId = "10000000-0000-4000-8000-000000000001";
    const response = await search(request(`http://localhost/api/v1/corpus/search?entryKind=lexeme&entryId=${entryId}&pageSize=6`));
    expect(response.status).toBe(200);
    expect(mocks.repository.searchCorpus).toHaveBeenCalledWith(user.id, { entryKind: "lexeme", entryId, page: 1, pageSize: 6 });

    const incomplete = await search(request("http://localhost/api/v1/corpus/search?entryKind=lexeme"));
    expect(incomplete.status).toBe(400);
  });

  it("does not expose accepted answers or skill keys", async () => {
    const response = await getAssessment(request("http://localhost/api/v1/lexicon/assessments/lexical.core"), { params: Promise.resolve({ assessmentId: "lexical.core" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ assessmentKey: "lexical.core", promptType: "recall" });
    expect(body.data).not.toHaveProperty("acceptedAnswers");
    expect(body.data).not.toHaveProperty("skillKey");
  });

  it("requires auth and sends only answer plus idempotency header", async () => {
    mocks.verifyRequestUser.mockResolvedValue(null);
    const unauthorized = await postAssessment(request("http://localhost/api/v1/lexicon/assessments/lexical.core", { method: "POST", body: JSON.stringify({ answer: "comer", score: 1 }), headers: { "content-type": "application/json", "idempotency-key": "attempt_12345678" } }), { params: Promise.resolve({ assessmentId: "lexical.core" }) });
    expect(unauthorized.status).toBe(401);

    mocks.verifyRequestUser.mockResolvedValue(user);
    const response = await postAssessment(request("http://localhost/api/v1/lexicon/assessments/lexical.core", { method: "POST", body: JSON.stringify({ answer: "comer", score: 1 }), headers: { "content-type": "application/json", "idempotency-key": "attempt_12345678" } }), { params: Promise.resolve({ assessmentId: "lexical.core" }) });
    expect(response.status).toBe(200);
    expect(mocks.repository.submitAssessment).toHaveBeenCalledWith(user.id, "lexical.core", expect.objectContaining({ answer: "comer", idempotencyKey: "attempt_12345678", requestHash: expect.stringMatching(/^[a-f0-9]{64}$/u) }));
  });

  it("maps missing assessments and idempotency conflicts", async () => {
    mocks.repository.submitAssessment.mockRejectedValueOnce(new LexicalAssessmentNotFoundError());
    const missing = await postAssessment(request("http://localhost/api/v1/lexicon/assessments/missing", { method: "POST", body: JSON.stringify({ answer: "comer" }), headers: { "content-type": "application/json", "idempotency-key": "attempt_12345678" } }), { params: Promise.resolve({ assessmentId: "missing" }) });
    expect(missing.status).toBe(404);
    mocks.repository.submitAssessment.mockRejectedValueOnce(new LexicalAssessmentConflictError("conflict"));
    const conflict = await postAssessment(request("http://localhost/api/v1/lexicon/assessments/lexical.core", { method: "POST", body: JSON.stringify({ answer: "comer" }), headers: { "content-type": "application/json", "idempotency-key": "attempt_12345679" } }), { params: Promise.resolve({ assessmentId: "lexical.core" }) });
    expect(conflict.status).toBe(409);
  });
});
