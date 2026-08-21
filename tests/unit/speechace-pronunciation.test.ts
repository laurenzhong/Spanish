import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PronunciationAssessmentError,
  type PronunciationAssessmentInput,
} from "@/src/modules/providers/pronunciation";
import {
  createSpeechacePronunciationProvider,
  SpeechacePronunciationProvider,
} from "@/src/modules/providers/pronunciation/server";

const input: PronunciationAssessmentInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm;codecs=opus",
  fileName: "answer.webm",
  locale: "es-ES",
  referenceText: "Que tal todo?",
  attemptId: "00000000-0000-4000-8000-000000000001",
  generationId: 4,
};

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = { "content-type": "application/json" },
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function successResponse() {
  return {
    status: "success",
    speech_score: { pronunciation: 87.5, fluency: 62.5 },
    transcript: "private transcript that must be discarded",
  };
}

describe("SpeechacePronunciationProvider", () => {
  it.each([
    ["es-ES", "es-es"],
    ["es-MX", "es-mx"],
  ] as const)("maps %s to the Speechace dialect %s", async (locale, dialect) => {
    let requestUrl: URL | undefined;
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = new URL(url.toString());
        request = init;
        return response(successResponse(), 200, {
          "content-type": "application/json",
          "x-request-id": "speechace-123",
        });
      },
    );
    const clock = vi.fn<() => number>().mockReturnValueOnce(1000).mockReturnValueOnce(1042);
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-speechace-key",
      fetchImplementation,
      clock,
    });

    const result = await provider.assess({ ...input, locale });
    const form = request?.body as FormData;
    const file = form.get("user_audio_file");

    expect(result).toEqual({
      quality: "usable",
      pronunciationScore: 0.875,
      fluencyScore: 0.625,
      prosodyScore: null,
      completenessScore: null,
      provider: "speechace",
      modelVersion: "speechace-v9",
      providerRequestId: "speechace-123",
      latencyMs: 42,
      estimatedCostMicros: null,
      retentionPolicy: "ephemeral",
    });
    expect("transcript" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private transcript");
    expect(requestUrl?.searchParams.get("key")).toBe("test-speechace-key");
    expect(requestUrl?.searchParams.get("dialect")).toBe(dialect);
    expect(request?.method).toBe("POST");
    expect(form.get("question_info")).toBe(input.attemptId);
    expect(form.get("relevance_context")).toBe(input.referenceText);
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/webm");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("returns insufficient quality when Speechace cannot produce both core scores", async () => {
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () =>
        response({ status: "success", speech_score: { pronunciation: null } }),
      ),
    });

    await expect(provider.assess(input)).resolves.toMatchObject({
      quality: "insufficient",
      pronunciationScore: null,
      fluencyScore: null,
      prosodyScore: null,
      completenessScore: null,
    });
  });

  it("rejects missing API configuration before making a request", async () => {
    const fetchImplementation = vi.fn();
    const provider = new SpeechacePronunciationProvider({
      apiKey: "  ",
      fetchImplementation,
    });

    await expect(provider.assess(input)).rejects.toMatchObject({
      code: "provider-auth-failed",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [401, "provider-auth-failed", false],
    [403, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [500, "provider-unavailable", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i to %s", async (status, code, retryable) => {
    const fetchImplementation = vi.fn(async () =>
      response({ error: "secret Speechace details" }, status),
    );
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    const failure = provider.assess(input);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow("secret Speechace details");
  });

  it("maps invalid JSON and malformed responses without exposing payloads", async () => {
    const invalidJson = vi.fn(async () =>
      new Response("not json", { status: 200 }),
    );
    const invalidJsonProvider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation: invalidJson,
    });
    await expect(invalidJsonProvider.assess(input)).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });

    const malformedProvider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation: vi.fn(async () =>
        response({ status: "success", speech_score: "invalid" }),
      ),
    });
    await expect(malformedProvider.assess(input)).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });
  });

  it("maps network failures to a retryable error without retrying", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error("socket and secret request details");
    });
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    const failure = provider.assess(input);
    await expect(failure).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: true,
    });
    await expect(failure).rejects.not.toThrow("socket and secret request details");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("distinguishes caller cancellation from the provider timeout", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 1000,
    });
    const controller = new AbortController();

    const pending = provider.assess(input, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
  });

  it("maps its own timeout to a retryable error", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const provider = new SpeechacePronunciationProvider({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 1,
    });

    await expect(provider.assess(input)).rejects.toMatchObject({
      code: "provider-timeout",
      retryable: true,
    });
  });

  it("loads the API key and endpoint from server environment through its factory", async () => {
    vi.stubEnv("SPEECHACE_API_KEY", "env-key");
    vi.stubEnv("SPEECHACE_API_ENDPOINT", "https://speechace.test/score");
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL) => {
      expect(new URL(url.toString()).origin).toBe("https://speechace.test");
      return response(successResponse());
    });
    const provider = createSpeechacePronunciationProvider({ fetchImplementation });

    await provider.assess(input);
    const requestUrl = new URL(fetchImplementation.mock.calls[0]?.[0]?.toString() ?? "");
    expect(requestUrl.searchParams.get("key")).toBe("env-key");
    vi.unstubAllEnvs();
  });
});

describe("PronunciationAssessmentError", () => {
  it("keeps provider secrets out of the stable error", () => {
    const error = new PronunciationAssessmentError(
      "provider-unavailable",
      "Pronunciation provider is temporarily unavailable.",
      true,
    );

    expect(error.message).not.toContain("test-key");
    expect(error.message).not.toContain("transcript");
  });
});
