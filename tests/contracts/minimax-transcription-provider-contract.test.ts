import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MiniMaxTranscriptionProvider } from "@/src/modules/providers/stt/minimax-transcription";

const input = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/mpeg",
  fileName: "episode.mp3",
  languageTag: "es-ES",
} as const;

function response(body: unknown, status = 200, headers: HeadersInit = { "content-type": "application/json" }) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("MiniMax speech-to-text provider contract", () => {
  it("sends the documented multipart request and maps timed segments", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response({
        text: "Hola. ¿Qué tal?",
        trace_id: "trace-1",
        duration: 2.5,
        segments: [
          { id: 0, start: 0.1, end: 0.9, speaker: "S1", text: "Hola." },
          { id: 1, start: 1.1, end: 2.4, speaker: "S1", text: "¿Qué tal?" },
        ],
      }, 200, { "content-type": "application/json" });
    });
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation });

    const result = await provider.transcribe(input);
    const form = request?.body as FormData;
    expect(result).toMatchObject({
      text: "Hola. ¿Qué tal?",
      provider: "minimax",
      modelVersion: "asr-1.0",
      providerRequestId: "trace-1",
      detectedLanguages: ["es"],
    });
    expect(result.segments).toEqual([
      { startMs: 100, endMs: 900, text: "Hola.", speaker: "S1", confidence: null },
      { startMs: 1100, endMs: 2400, text: "¿Qué tal?", speaker: "S1", confidence: null },
    ]);
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ Authorization: "Bearer test-key", language: "es" });
    expect(form.get("model")).toBe("asr-1.0");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("timestamp_level")).toBe("sentence");
    expect(form.get("stream")).toBe("false");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it.each([
    [401, "provider-auth-failed", false],
    [402, "provider-response-invalid", false],
    [413, "audio-too-large", false],
    [429, "provider-rate-limited", true],
    [500, "provider-unavailable", true],
  ] as const)("maps HTTP %i to a stable error", async (status, code, retryable) => {
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation: vi.fn(async () => response({ error: "secret" }, status)) });
    const failure = provider.transcribe(input);
    await expect(failure).rejects.toMatchObject({ code, retryable });
    await expect(failure).rejects.not.toThrow("secret");
  });

  it("rejects malformed timelines without exposing provider payloads", async () => {
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation: vi.fn(async () => response({ text: "Hola", segments: [{ start: 2, end: 1, text: "Hola" }] })) });
    await expect(provider.transcribe(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });
});
