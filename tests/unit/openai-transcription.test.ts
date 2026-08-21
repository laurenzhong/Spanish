import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  FakeSpeechToTextProvider,
  SpeechToTextError,
  maxTranscriptionAudioBytes,
  type SpeechToTextInput,
} from "@/src/modules/providers/stt";
import { OpenAITranscriptionProvider } from "@/src/modules/providers/stt/server";

const input: SpeechToTextInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/webm;codecs=opus",
  fileName: "answer.webm",
  languageTag: "es-ES",
};

function response(
  body: unknown,
  status = 200,
  headers: HeadersInit = { "content-type": "application/json" },
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("OpenAITranscriptionProvider", () => {
  it("maps a completed Spanish recording to the internal result", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        request = init;
        return response(
          { text: "Hola, ¿qué tal?", languages: [{ code: "es" }] },
          200,
          { "content-type": "application/json", "x-request-id": "req-123" },
        );
      },
    );
    const clock = vi
      .fn<() => number>()
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1042);
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
      clock,
    });

    const result = await provider.transcribe(input);
    const form = request?.body as FormData;
    const file = form.get("file");

    expect(result).toEqual({
      text: "Hola, ¿qué tal?",
      detectedLanguages: ["es"],
      confidence: null,
      confidenceAvailability: "unavailable",
      provider: "openai",
      modelVersion: "gpt-transcribe",
      providerRequestId: "req-123",
      latencyMs: 42,
      estimatedCostMicros: null,
      retentionPolicy: "ephemeral",
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(form.get("model")).toBe("gpt-transcribe");
    expect(form.get("languages[]")).toBe("es");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/webm");
  });

  it("rejects invalid audio before making a provider request", async () => {
    const fetchImplementation = vi.fn();
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    await expect(
      provider.transcribe({ ...input, audioBytes: new Uint8Array() }),
    ).rejects.toMatchObject({ code: "audio-invalid", retryable: false });
    await expect(
      provider.transcribe({
        ...input,
        audioBytes: new Uint8Array(maxTranscriptionAudioBytes + 1),
      }),
    ).rejects.toMatchObject({ code: "audio-too-large", retryable: false });
    await expect(
      provider.transcribe({ ...input, mimeType: "audio/ogg" }),
    ).rejects.toMatchObject({
      code: "audio-format-unsupported",
      retryable: false,
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    [401, "provider-auth-failed", false],
    [429, "provider-rate-limited", true],
    [503, "provider-unavailable", true],
  ] as const)("maps HTTP %i without exposing response details", async (status, code, retryable) => {
    const fetchImplementation = vi.fn(async () => response({ error: "secret provider details" }, status));
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    const failure = provider.transcribe(input);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow("secret provider details");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("maps malformed successful responses to a non-retryable provider error", async () => {
    const fetchImplementation = vi.fn(async () => response({ languages: [{ code: "es" }] }));
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "provider-response-invalid",
      retryable: false,
    });
  });

  it("maps network failures to a retryable error without retrying automatically", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new Error("socket details");
    });
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
    });

    const failure = provider.transcribe(input);
    await expect(failure).rejects.toMatchObject({
      code: "provider-unavailable",
      retryable: true,
    });
    await expect(failure).rejects.not.toThrow("socket details");
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
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 1000,
    });
    const controller = new AbortController();

    const pending = provider.transcribe(input, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({
      code: "provider-cancelled",
      retryable: false,
    });
  });

  it("maps its own timeout as retryable", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const provider = new OpenAITranscriptionProvider({
      apiKey: "test-key",
      fetchImplementation,
      timeoutMs: 1,
    });

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "provider-timeout",
      retryable: true,
    });
  });
});

describe("FakeSpeechToTextProvider", () => {
  it("records the input and returns a deterministic transcript", async () => {
    const provider = new FakeSpeechToTextProvider();

    const result = await provider.transcribe(input);

    expect(result.text).toBe("Hola, ¿qué tal?");
    expect(provider.inputs).toEqual([input]);
  });

  it("supports deterministic failures without calling a real provider", async () => {
    const provider = new FakeSpeechToTextProvider(
      new SpeechToTextError("provider-rate-limited", "rate limited", true),
    );

    await expect(provider.transcribe(input)).rejects.toMatchObject({
      code: "provider-rate-limited",
      retryable: true,
    });
  });
});
