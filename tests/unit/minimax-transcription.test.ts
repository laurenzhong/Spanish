import { describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const actualWithDefault = actual as typeof actual & { default?: Record<string, unknown> };
  return { ...actual, spawn: spawnMock, default: { ...(actualWithDefault.default ?? {}), spawn: spawnMock } };
});
vi.mock("server-only", () => ({}));

import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { maxTranscriptionAudioBytes, type SpeechToTextInput } from "@/src/modules/providers/stt";
import { MiniMaxTranscriptionProvider, chunkOffsetMs, flattenUnits } from "@/src/modules/providers/stt/server";

const input: SpeechToTextInput = {
  audioBytes: new Uint8Array([1, 2, 3]),
  mimeType: "audio/mpeg",
  fileName: "episode.mp3",
  languageTag: "es-ES",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("MiniMaxTranscriptionProvider", () => {
  it("maps a verbose timestamp response to the internal transcript result", async () => {
    let request: RequestInit | undefined;
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      request = init;
      return response({ text: "Hola, ¿qué tal?", duration: 3.2, trace_id: "trace-123", segments: [{ id: 0, start: 0.1, end: 2.4, text: "Hola, ¿qué tal?" }] });
    });
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation });

    await expect(provider.transcribe(input)).resolves.toMatchObject({
      text: "Hola, ¿qué tal?",
      detectedLanguages: ["es-ES"],
      provider: "minimax",
      modelVersion: "asr-1.0",
      providerRequestId: "trace-123",
      retentionPolicy: "ephemeral",
    });
    const form = request?.body as FormData;
    expect(request?.method).toBe("POST");
    expect(request?.headers).toEqual({ Authorization: "Bearer test-key" });
    expect(form.get("model")).toBe("asr-1.0");
    expect(form.get("response_format")).toBe("verbose_json");
    expect(form.get("timestamp_level")).toBe("sentence");
    expect(form.get("stream")).toBe("false");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("maps provider status errors and validates the existing 25 MB input gate", async () => {
    const fetchImplementation = vi.fn(async () => response({ error: "rate limited" }, 429));
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation });
    await expect(provider.transcribe(input)).rejects.toMatchObject({ code: "provider-rate-limited", retryable: true });
    await expect(provider.transcribe({ ...input, audioBytes: new Uint8Array(maxTranscriptionAudioBytes + 1) })).rejects.toMatchObject({ code: "audio-too-large", retryable: false });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("reports its own timeout separately from caller cancellation", async () => {
    const fetchImplementation = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", timeoutMs: 5, fetchImplementation });
    await expect(provider.transcribe(input)).rejects.toMatchObject({ code: "provider-timeout", retryable: true });
  });

  it("chunks long audio from the temporary asset path and removes the chunk directory", async () => {
    const assetDirectory = await mkdtemp(path.join(tmpdir(), "sueno-minimax-test-"));
    const assetPath = path.join(assetDirectory, "episode.mp3");
    await writeFile(assetPath, new Uint8Array([1, 2, 3]));

    try {
      let outputPattern = "";
      spawnMock.mockImplementation((_command: string, args: readonly string[]) => {
        outputPattern = String(args.at(-1));
        const child = new EventEmitter() as EventEmitter & { kill: () => void };
        child.kill = vi.fn();
        queueMicrotask(() => {
          writeFileSync(outputPattern.replace("%03d", "000"), new Uint8Array([4, 5, 6]));
          child.emit("close", 0);
        });
        return child;
      });

      const fetchImplementation = vi.fn(async () => response({ text: "Hola desde un fragmento." }));
      const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation });

      await expect(provider.transcribe({ ...input, assetPath, durationMs: 500_001 })).resolves.toMatchObject({
        text: "Hola desde un fragmento.",
        provider: "minimax",
      });
      expect(spawnMock).toHaveBeenCalledOnce();
      expect(spawnMock.mock.calls[0]?.[1]).toContain(assetPath);
      expect(fetchImplementation).toHaveBeenCalledOnce();
      await expect(access(path.dirname(outputPattern))).rejects.toThrow();
    } finally {
      spawnMock.mockReset();
      await rm(assetDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed when long audio has no temporary asset path", async () => {
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation: vi.fn() });
    await expect(provider.transcribe({ ...input, durationMs: 500_001 })).rejects.toMatchObject({
      code: "audio-invalid",
      retryable: false,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("omits a timed timeline unless word level was requested", async () => {
    const wordUnits = [
      { start: 0.1, end: 0.5, text: "Hola" },
      { start: 0.5, end: 0.9, text: "¿qué" },
      { start: 0.9, end: 1.3, text: "tal?" },
    ];
    const fetchImplementation = vi.fn<typeof fetch>(async () => response({
      text: "Hola ¿qué tal?",
      segments: [{ start: 0.1, end: 2.4, text: "Hola ¿qué tal?" }],
    }));
    const wordFetch = vi.fn<typeof fetch>(async () => response({ text: "Hola ¿qué tal?", segments: wordUnits }));

    const sentence = await new MiniMaxTranscriptionProvider({ apiKey: "test-key", fetchImplementation }).transcribe(input);
    expect(sentence.segments).toBeUndefined();
    expect((fetchImplementation.mock.calls[0]?.[1]?.body as FormData).get("timestamp_level")).toBe("sentence");

    const word = await new MiniMaxTranscriptionProvider({ apiKey: "test-key", timestampLevel: "word", fetchImplementation: wordFetch }).transcribe(input);
    expect((wordFetch.mock.calls[0]?.[1]?.body as FormData).get("timestamp_level")).toBe("word");
    // Grouped into one readable segment, with each word keeping its own offsets
    // into the segment text and its own position in the audio.
    expect(word.segments).toEqual([
      {
        text: "Hola ¿qué tal?",
        startMs: 100,
        endMs: 1_300,
        speaker: null,
        confidence: null,
        words: [
          { startMs: 100, endMs: 500, startOffset: 0, endOffset: 4 },
          { startMs: 500, endMs: 900, startOffset: 6, endOffset: 9 },
          { startMs: 900, endMs: 1_300, startOffset: 10, endOffset: 13 },
        ],
      },
    ]);
  });

  it("fails closed when a word timeline is not monotonically increasing", async () => {
    const fetchImplementation = vi.fn(async () => response({
      text: "Hola",
      segments: [{ start: 2, end: 1, text: "Hola" }],
    }));
    const provider = new MiniMaxTranscriptionProvider({ apiKey: "test-key", timestampLevel: "word", fetchImplementation });

    await expect(provider.transcribe(input)).rejects.toMatchObject({ code: "provider-response-invalid", retryable: false });
  });

  it("moves each chunk's word timings onto the asset timeline", async () => {
    const first = { text: "uno", startMs: 500, endMs: 900, speaker: null, confidence: null } as const;
    const second = { text: "dos", startMs: 200, endMs: 600, speaker: null, confidence: null } as const;

    expect(flattenUnits([{ text: "uno", requestId: null, units: [first] }])).toEqual([first]);
    expect(flattenUnits([
      { text: "uno", requestId: null, units: [first], offsetMs: 0 },
      { text: "dos", requestId: null, units: [second], offsetMs: 450_000 },
    ])).toEqual([first, { ...second, startMs: 450_200, endMs: 450_600 }]);
    // ffmpeg writes parts at the configured segment length (450s).
    expect(chunkOffsetMs("chunk-000.mp3")).toBe(0);
    expect(chunkOffsetMs("chunk-002.mp3")).toBe(900_000);
  });
});
