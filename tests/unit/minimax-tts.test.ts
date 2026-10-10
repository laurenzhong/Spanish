import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MiniMaxTextToSpeech } from "@/src/modules/providers/tts/minimax-tts";

describe("MiniMaxTextToSpeech", () => {
  it("converts the provider hex audio response to MP3 bytes", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: "494433" }, base_resp: { status_code: 0 } }), { status: 200 }));
    const tts = new MiniMaxTextToSpeech({ apiKey: "key", voiceId: "voice", fetchImplementation });
    await expect(tts.synthesize("Hola")).resolves.toEqual(new Uint8Array([0x49, 0x44, 0x33]));
    expect(fetchImplementation).toHaveBeenCalledWith("https://api.minimax.cn/v1/t2a_v2", expect.objectContaining({ method: "POST" }));
  });

  it("fails closed when no voice is configured", async () => {
    const tts = new MiniMaxTextToSpeech({ apiKey: "key", voiceId: "" });
    await expect(tts.synthesize("Hola")).rejects.toMatchObject({ code: "not-configured" });
  });
});
