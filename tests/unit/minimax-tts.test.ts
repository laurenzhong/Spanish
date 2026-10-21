import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MiniMaxTextToSpeech } from "@/src/modules/providers/tts/minimax-tts";
import { READ_ALOUD_POLICY } from "@/src/modules/providers/tts/policy";

// A complete MPEG-1 Layer III frame for structural validation (playback is tested separately).
const mp3 = new Uint8Array(417);
mp3.set([0xff, 0xfb, 0x90, 0x64]);
const mp3Hex = Buffer.from(mp3).toString("hex");

describe("MiniMaxTextToSpeech", () => {
  it("converts the provider hex audio response to MP3 bytes", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: mp3Hex }, base_resp: { status_code: 0 } }), { status: 200 }));
    const tts = new MiniMaxTextToSpeech({ apiKey: "key", voiceId: "voice", fetchImplementation });
    await expect(tts.synthesize("Hola")).resolves.toEqual(mp3);
    expect(fetchImplementation).toHaveBeenCalledWith("https://api.minimax.cn/v1/t2a_v2", expect.objectContaining({ method: "POST" }));
  });

  it("fails closed when no voice is configured", async () => {
    const tts = new MiniMaxTextToSpeech({ apiKey: "key", voiceId: "" });
    await expect(tts.synthesize("Hola")).rejects.toMatchObject({ code: "not-configured" });
  });

  it("uses the selected female audition standard even if legacy env overrides exist", async () => {
    vi.stubEnv("MINIMAX_TTS_VOICE_ID", "legacy-voice");
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: mp3Hex }, base_resp: { status_code: 0 }, trace_id: "provider-request", extra_info: { usage_characters: 4 } })));
    try {
      const result = await new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesizeDetailed("Hola");
      const body = JSON.parse(fetchImplementation.mock.calls[0][1].body);
      expect(body).toMatchObject({ model: "speech-2.8-turbo", voice_setting: { voice_id: "Spanish_SereneWoman", speed: 1 }, language_boost: "Spanish" });
      expect(result.metadata).toMatchObject({ requestId: "provider-request", billableCharacters: 4, estimatedCost: null });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([1002, 1039])("maps provider rate rejection %s without requiring audio", async (status_code) => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ base_resp: { status_code } })));
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).rejects.toMatchObject({ code: "rate-limited" });
  });

  it("never starts an already cancelled request", async () => {
    const fetchImplementation = vi.fn();
    const controller = new AbortController(); controller.abort();
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("does not accept an explicitly incomplete non-streaming response", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: "494433", status: 1 }, base_resp: { status_code: 0 } })));
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).rejects.toMatchObject({ code: "invalid-response" });
  });

  it.each(["00", "494433", "fffb9064", "4944330400000000007f" + mp3Hex])("rejects corrupt or truncated MP3 before the application can cache it", async (audio) => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio }, base_resp: { status_code: 0 } })));
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("accepts a complete ID3 tag followed by a complete MP3 frame", async () => {
    const audio = "49443304000000000000" + mp3Hex;
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio }, base_resp: { status_code: 0 } })));
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).resolves.toHaveLength(427);
  });

  it("rejects declared oversized responses before reading the body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(READ_ALOUD_POLICY.maxAudioBytes * 2 + 65_537) } });
    const fetchImplementation = vi.fn().mockResolvedValue(response);
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).rejects.toMatchObject({ code: "invalid-response" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds streamed JSON even when content-length is absent", async () => {
    const cancel = vi.fn();
    let chunks = 0;
    const response = new Response(new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel }));
    const fetchImplementation = vi.fn().mockResolvedValue(response);
    await expect(new MiniMaxTextToSpeech({ apiKey: "key", fetchImplementation }).synthesize("Hola")).rejects.toMatchObject({ code: "invalid-response" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(chunks).toBeLessThanOrEqual(10);
  });
});
