import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createOpenAITranslationProvider } from "@/src/modules/providers/translation/openai-translation";
import { createOpenAITranscriptionProvider } from "@/src/modules/providers/stt/openai-transcription";

const input = { text: "Hola.", sourceLocale: "es-ES", targetLocale: "zh-CN" };
const payload = (finish_reason = "stop", content = "你好。") => ({ model: "gpt-4.1-mini-test", choices: [{ finish_reason, message: { content } }] });
describe("OpenAI subtitle providers", () => {
  it("uses the official translation endpoint and records returned model", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload(), { headers: { "x-request-id": "req-test" } }));
    const result = await createOpenAITranslationProvider({ apiKey: "fake", fetchImplementation }).translate(input);
    expect(result).toMatchObject({ provider: "openai", modelVersion: "gpt-4.1-mini-test", text: "你好。", providerRequestId: "req-test" });
    expect(fetchImplementation.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(fetchImplementation.mock.calls[0][1]?.body as string);
    expect(body.messages[1].content).toBe(JSON.stringify(input));
  });
  it.each(["length", "tool_calls", "content_filter"])("rejects unfinished %s responses", async (reason) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload(reason)));
    await expect(createOpenAITranslationProvider({ apiKey: "fake", fetchImplementation }).translate(input)).rejects.toMatchObject({ code: "provider-response-invalid" });
  });
  it("does not send pre-cancelled requests", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    await expect(createOpenAITranslationProvider({ apiKey: "fake", fetchImplementation }).translate(input, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "provider-cancelled" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
  it.each([[401, "provider-auth-failed"], [429, "provider-rate-limited"], [500, "provider-unavailable"]])("sanitizes HTTP %s errors", async (status, code) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("secret", { status: Number(status) }));
    await expect(createOpenAITranslationProvider({ apiKey: "fake", fetchImplementation }).translate(input)).rejects.toMatchObject({ code, message: "Translation provider request failed." });
  });
  it("requests true Whisper word timestamps and preserves offsets", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ text: "Hola mundo.", words: [{ word: "Hola", start: 0.1, end: 0.4 }, { word: "mundo.", start: 0.5, end: 0.9 }] }));
    const result = await createOpenAITranscriptionProvider({ apiKey: "fake", model: "whisper-1", wordTimestamps: true, fetchImplementation }).transcribe({ audioBytes: new Uint8Array([1, 2]), mimeType: "audio/wav", fileName: "test.wav", languageTag: "es-ES" });
    const form = fetchImplementation.mock.calls[0][1]?.body as FormData;
    expect(form.getAll("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(form.get("language")).toBe("es");
    expect(result.segments?.[0].words).toEqual([{ startMs: 100, endMs: 400, startOffset: 0, endOffset: 4 }, { startMs: 500, endMs: 900, startOffset: 5, endOffset: 10 }]);
  });
});
