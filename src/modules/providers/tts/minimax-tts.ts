import "server-only";

import { z } from "zod";
import { READ_ALOUD_POLICY } from "./policy";

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
  data: z.object({ audio: z.string().min(1), status: z.literal(2).optional() }).passthrough(),
  base_resp: z.object({ status_code: z.number(), status_msg: z.string().optional() }).optional(),
  trace_id: z.string().optional(),
  extra_info: z.object({ usage_characters: z.number().nonnegative().optional() }).passthrough().optional(),
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
    this.model = options.model ?? READ_ALOUD_POLICY.model;
    this.voiceId = options.voiceId ?? READ_ALOUD_POLICY.voiceId;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    return (await this.synthesizeDetailed(text, signal)).audio;
  }

  async synthesizeDetailed(text: string, signal?: AbortSignal): Promise<SynthesizedSpeech> {
    if (!this.apiKey.trim() || !this.voiceId.trim()) throw new MiniMaxTtsError("not-configured", "MiniMax TTS is not configured.");
    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    try {
      if (controller.signal.aborted) throw new MiniMaxTtsError("cancelled", "MiniMax TTS request was cancelled.");
      const response = await this.fetchImplementation(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          text,
          stream: false,
          voice_setting: { voice_id: this.voiceId, speed: READ_ALOUD_POLICY.synthesisSpeed, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: READ_ALOUD_POLICY.sampleRate, bitrate: READ_ALOUD_POLICY.bitrate, format: "mp3", channel: 1 },
          language_boost: "Spanish",
          output_format: "hex",
          aigc_watermark: false,
        }),
        signal: controller.signal,
      });
      if (response.status === 429) throw new MiniMaxTtsError("rate-limited", "MiniMax TTS rate limit reached.");
      if (!response.ok) throw new MiniMaxTtsError("provider-unavailable", "MiniMax TTS request failed.");
      const raw: unknown = await readLimitedJson(response);
      const status = z.object({ base_resp: z.object({ status_code: z.number() }) }).safeParse(raw);
      if (status.success && [1002, 1039].includes(status.data.base_resp.status_code)) throw new MiniMaxTtsError("rate-limited", "MiniMax TTS rate limit reached.");
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success || parsed.data.base_resp?.status_code && parsed.data.base_resp.status_code !== 0) throw new MiniMaxTtsError("invalid-response", "MiniMax TTS response was invalid.");
      const hex = parsed.data.data.audio;
      if (hex.length > READ_ALOUD_POLICY.maxAudioBytes * 2 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(hex)) throw new MiniMaxTtsError("invalid-response", "MiniMax TTS audio was invalid.");
      const bytes = new Uint8Array(hex.length / 2);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      if (!hasCompleteMp3Frame(bytes)) throw new MiniMaxTtsError("invalid-response", "MiniMax TTS audio was invalid.");
      return { audio: bytes, metadata: { provider: "minimax", model: this.model, voiceId: this.voiceId,
        requestId: parsed.data.trace_id ?? null, latencyMs: Date.now() - startedAt,
        billableCharacters: parsed.data.extra_info?.usage_characters ?? null,
        estimatedCost: null, confidence: null } };
    } catch (error) {
      if (error instanceof MiniMaxTtsError) throw error;
      if (controller.signal.aborted) throw new MiniMaxTtsError(signal?.aborted ? "cancelled" : "provider-unavailable", "MiniMax TTS request was cancelled or timed out.");
      throw new MiniMaxTtsError("provider-unavailable", "MiniMax TTS is temporarily unavailable.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const limit = READ_ALOUD_POLICY.maxAudioBytes * 2 + 65_536;
  const invalid = () => new MiniMaxTtsError("invalid-response", "MiniMax TTS response was invalid or too large.");
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw invalid();
  }
  if (!response.body) throw invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) { await reader.cancel(); throw invalid(); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw invalid(); }
}

/** Validate the optional ID3 tag and a complete MPEG Layer III frame before caching. */
function hasCompleteMp3Frame(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
    if (bytes.length < 10 || bytes.slice(6, 10).some((value) => value > 127)) return false;
    const size = bytes[6] * 2 ** 21 + bytes[7] * 2 ** 14 + bytes[8] * 128 + bytes[9];
    offset = 10 + size + (bytes[3] === 4 && (bytes[5] & 16) !== 0 ? 10 : 0);
  }
  if (offset + 4 > bytes.length || bytes[offset] !== 255 || (bytes[offset + 1] & 224) !== 224) return false;
  const version = (bytes[offset + 1] >> 3) & 3;
  if (version === 1 || ((bytes[offset + 1] >> 1) & 3) !== 1) return false;
  const bitrateIndex = bytes[offset + 2] >> 4;
  const sampleIndex = (bytes[offset + 2] >> 2) & 3;
  if (bitrateIndex < 1 || bitrateIndex > 14 || sampleIndex > 2) return false;
  const rates = version === 3 ? [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sampleRate = [44_100, 48_000, 32_000][sampleIndex] / (version === 3 ? 1 : version === 2 ? 2 : 4);
  const frameLength = Math.floor((version === 3 ? 144_000 : 72_000) * rates[bitrateIndex - 1] / sampleRate) + ((bytes[offset + 2] >> 1) & 1);
  return bytes.length >= offset + frameLength;
}

export type SynthesizedSpeech = Readonly<{
  audio: Uint8Array;
  metadata: Readonly<{ provider: "minimax"; model: string; voiceId: string; requestId: string | null;
    latencyMs: number; billableCharacters: number | null; estimatedCost: null; confidence: null }>;
}>;

export interface ReadAloudProvider {
  synthesizeDetailed(text: string, signal?: AbortSignal): Promise<SynthesizedSpeech>;
}

export function createMiniMaxTextToSpeech(options: MiniMaxTtsOptions = {}): MiniMaxTextToSpeech {
  return new MiniMaxTextToSpeech(options);
}
