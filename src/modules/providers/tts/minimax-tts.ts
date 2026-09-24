import "server-only";

import { z } from "zod";

export class MiniMaxTtsError extends Error {
  constructor(
    readonly code: "not-configured" | "rate-limited" | "provider-unavailable" | "invalid-response" | "cancelled",
    message: string,
  ) {
    super(message);
    this.name = "MiniMaxTtsError";
  }
}

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MiniMaxTtsOptions = Readonly<{
  apiKey?: string;
  endpoint?: string;
  model?: string;
  voiceId?: string;
  timeoutMs?: number;
  fetchImplementation?: FetchImplementation;
}>;

const responseSchema = z.object({
  data: z.object({ audio: z.string().min(1), status: z.number().optional() }).passthrough(),
  base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).optional(),
}).passthrough();

export class MiniMaxTextToSpeech {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly model: string;
  private readonly voiceId: string;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: MiniMaxTtsOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.MINIMAX_API_KEY ?? "";
    this.endpoint = options.endpoint ?? process.env.MINIMAX_TTS_API_ENDPOINT ?? "https://api.minimax.cn/v1/t2a_v2";
    this.model = options.model ?? process.env.MINIMAX_TTS_MODEL ?? "speech-2.8-turbo";
    this.voiceId = options.voiceId ?? process.env.MINIMAX_TTS_VOICE_ID ?? "";
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    if (!this.apiKey.trim() || !this.voiceId.trim()) throw new MiniMaxTtsError("not-configured", "MiniMax TTS is not configured.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    try {
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          text,
          stream: false,
          voice_setting: { voice_id: this.voiceId, speed: 0.88, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: "mp3", channel: 1 },
          language_boost: "Spanish",
          output_format: "hex",
          aigc_watermark: false,
        }),
        signal: controller.signal,
      });
      if (response.status === 429) throw new MiniMaxTtsError("rate-limited", "MiniMax TTS rate limit reached.");
      if (!response.ok) throw new MiniMaxTtsError("provider-unavailable", "MiniMax TTS request failed.");
      const parsed = responseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success || parsed.data.base_resp?.status_code && parsed.data.base_resp.status_code !== 0) throw new MiniMaxTtsError("invalid-response", "MiniMax TTS response was invalid.");
      const hex = parsed.data.data.audio;
      if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) throw new MiniMaxTtsError("invalid-response", "MiniMax TTS audio was invalid.");
      const bytes = new Uint8Array(hex.length / 2);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      return bytes;
    } catch (error) {
      if (error instanceof MiniMaxTtsError) throw error;
      if (controller.signal.aborted) throw new MiniMaxTtsError(signal?.aborted ? "cancelled" : "provider-unavailable", "MiniMax TTS request was cancelled or timed out.");
      throw new MiniMaxTtsError("provider-unavailable", "MiniMax TTS is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function createMiniMaxTextToSpeech(options: MiniMaxTtsOptions = {}): MiniMaxTextToSpeech {
  return new MiniMaxTextToSpeech(options);
}
