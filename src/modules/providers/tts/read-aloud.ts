"use client";

import { SpeechCapabilityError, type SpeechCapabilityErrorCode } from "../speech/speech-capability";
import { READ_ALOUD_POLICY } from "./policy";
import { ReadAloudReplayCache, subscribeReadAloudSessionChanges } from "./read-aloud-replay-cache";

export type ReadAloudOptions = Readonly<{ languageTag: string; rate?: number; onStart?: () => void }>;
export type ReadAloud = Readonly<{
  isSupported: boolean;
  speak: (text: string, options: ReadAloudOptions) => Promise<void>;
  stop: () => void;
}>;
type Dependencies = Readonly<{
  fetch: typeof fetch;
  createAudio: () => HTMLAudioElement;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  subscribeSessionChanges: (invalidate: () => void) => () => void;
}>;
const failure = (code: SpeechCapabilityErrorCode) => new SpeechCapabilityError(code, code);

function isSpanishLanguageTag(languageTag: string): boolean {
  if (!/^es(?:-[a-z0-9]{2,8})*$/iu.test(languageTag)) return false;
  try { return new Intl.Locale(languageTag).language === "es"; }
  catch { return false; }
}

export function readAloudErrorMessage(error: unknown): string {
  const code = error instanceof SpeechCapabilityError ? error.code : undefined;
  if (code === "tts-stalled") return "朗读等待超时或播放中断，请再试一次。";
  if (code === "tts-not-supported") return "当前浏览器无法播放朗读音频。";
  if (code === "tts-no-audio") return "朗读音频无效或没有出声，请再试一次。";
  return "暂时无法朗读，请检查网络后再试一次。";
}

/** Preserve every source character, favoring complete sentences and then spaces. */
export function splitReadAloudText(text: string, maximum: number = READ_ALOUD_POLICY.maxChunkCharacters): string[] {
  if (!Number.isInteger(maximum) || maximum < 2) throw new Error("invalid-chunk-size");
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    // Small first response gets long passages speaking sooner on slow networks.
    // Later chunks retain the existing larger size to limit requests and pauses.
    const limit = offset === 0 && text.length > 300 ? Math.min(maximum, 180) : maximum;
    let length = Math.min(limit, text.length - offset);
    if (offset + length < text.length) {
      const candidate = text.slice(offset, offset + length);
      const last = [...candidate.matchAll(/[.!?…]["'»”’)]*\s+|\n+/gu)].at(-1);
      const whitespace = candidate.search(/\s+\S*$/u);
      if (last) length = last.index + last[0].length;
      else if (whitespace > 0) length = whitespace + 1;
      if (/[\uD800-\uDBFF]/u.test(text[offset + length - 1] ?? "")) length--;
    }
    chunks.push(text.slice(offset, offset + length));
    offset += length;
  }
  return chunks;
}

let active: { stop: () => void } | null = null;
// One silent PCM sample, used only to unlock the same element during a user gesture.
const silentUnlock = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==";

export function createReadAloud(overrides: Partial<Dependencies> = {}): ReadAloud {
  const supported = typeof window !== "undefined" && typeof Audio !== "undefined" &&
    typeof fetch !== "undefined" && (Boolean(overrides.createObjectURL) || typeof URL.createObjectURL === "function");
  const deps: Dependencies = {
    fetch: (...args) => fetch(...args), createAudio: () => new Audio(),
    createObjectURL: (blob) => URL.createObjectURL(blob), revokeObjectURL: (url) => URL.revokeObjectURL(url),
    subscribeSessionChanges: subscribeReadAloudSessionChanges,
    ...overrides,
  };
  let owned: { stop: () => void } | null = null;
  const stop = () => { replay.clear(); owned?.stop(); };
  const replay = new ReadAloudReplayCache(stop, deps.subscribeSessionChanges);
  const speak = (text: string, options: ReadAloudOptions): Promise<void> => {
    owned?.stop();
    if (!supported || !isSpanishLanguageTag(options.languageTag)) return Promise.reject(failure("tts-not-supported"));
    if (!text.trim()) return Promise.reject(failure("tts-failed"));
    active?.stop();
    const audio = deps.createAudio();
    const controller = new AbortController();
    const cleanups = new Set<() => void>();
    let isStopped = false;
    let url: string | null = null;
    let hasStarted = false;
    let cancel!: (error: Error) => void;
    const cancellation = new Promise<never>((_, reject) => { cancel = reject; });
    void cancellation.catch(() => undefined);
    const owner = { stop: () => {
      if (isStopped) return;
      isStopped = true;
      controller.abort();
      cancel(failure("tts-cancelled"));
      release();
    } };
    owned = owner;
    active = owner;
    const releaseReplay = replay.begin();
    cleanups.add(releaseReplay);
    function release() {
      for (const cleanup of cleanups) cleanup();
      cleanups.clear();
      audio.pause(); audio.removeAttribute("src"); audio.load();
      if (url) deps.revokeObjectURL(url);
      url = null;
      if (active === owner) active = null;
      if (owned === owner) owned = null;
    }
    const check = () => { if (isStopped) throw failure("tts-cancelled"); };
    const bounded = async <T,>(work: Promise<T>, milliseconds: number): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(failure("tts-stalled")); }, milliseconds);
      });
      try { return await Promise.race([work, expired, cancellation]); }
      finally { clearTimeout(timer); }
    };
    // Safari: call play synchronously, then reuse this element for fetched audio.
    // Devices may still reject autoplay after loading; that rejection is surfaced.
    audio.src = silentUnlock;
    let unlock: Promise<void>;
    try { unlock = Promise.resolve(audio.play()); }
    catch { unlock = Promise.reject(failure("tts-failed")); }

    const playChunk = () => new Promise<void>((resolve, reject) => {
      let watchdog: ReturnType<typeof setTimeout>;
      let started = false;
      let lastTime = 0;
      let finished = false;
      const arm = (milliseconds: number) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => finish(failure("tts-stalled")), milliseconds);
      };
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true; cleanup();
        if (error) reject(error); else resolve();
      };
      const playing = () => {
        started = true; arm(30_000);
        if (!hasStarted) { hasStarted = true; options.onStart?.(); }
      };
      const progress = () => {
        if (started && audio.currentTime > lastTime) { lastTime = audio.currentTime; arm(30_000); }
      };
      const ended = () => finish(started ? undefined : failure("tts-no-audio"));
      const failed = () => finish(failure("tts-no-audio"));
      const cleanup = () => {
        clearTimeout(watchdog);
        audio.removeEventListener("playing", playing); audio.removeEventListener("timeupdate", progress);
        audio.removeEventListener("ended", ended); audio.removeEventListener("error", failed);
        cleanups.delete(cleanup);
      };
      cleanups.add(cleanup);
      audio.addEventListener("playing", playing); audio.addEventListener("timeupdate", progress);
      audio.addEventListener("ended", ended); audio.addEventListener("error", failed);
      arm(20_000);
      try { void Promise.resolve(audio.play()).catch(() => finish(failure("tts-failed"))); }
      catch { finish(failure("tts-failed")); }
    });

    return (async () => {
      try {
        await bounded(unlock, 5000);
        check(); audio.pause();
        for (const chunk of splitReadAloudText(text)) {
          check();
          if (!chunk.trim()) continue;
          const buffer = replay.get(chunk) ?? await bounded((async () => {
            const response = await deps.fetch("/api/v1/tts", {
              method: "POST", credentials: "same-origin", cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: chunk, languageTag: READ_ALOUD_POLICY.languageTag }), signal: controller.signal,
            });
            check();
            if (!response.ok) throw failure("tts-failed");
            if (response.headers.get("content-type")?.split(";")[0]?.trim() !== "audio/mpeg") throw failure("tts-no-audio");
            if (Number(response.headers.get("content-length")) > READ_ALOUD_POLICY.maxAudioBytes) throw failure("tts-no-audio");
            const result = await response.arrayBuffer();
            check();
            const bytes = new Uint8Array(result);
            const expected = response.headers.get("content-length");
            const id3 = bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51;
            const frame = bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224;
            if (bytes.length < 4 || bytes.length > READ_ALOUD_POLICY.maxAudioBytes || (!id3 && !frame) ||
                (expected !== null && Number(expected) !== bytes.length)) throw failure("tts-no-audio");
            return result;
          })(), 45_000);
          check();
          url = deps.createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
          audio.src = url;
          audio.playbackRate = Number.isFinite(options.rate) ? Math.max(0.5, Math.min(2, options.rate!)) : 1;
          await bounded(playChunk(), 600_000);
          check();
          replay.set(chunk, buffer);
          audio.removeAttribute("src"); audio.load();
          deps.revokeObjectURL(url); url = null;
        }
      } catch (error) {
        if (isStopped) throw failure("tts-cancelled");
        if (error instanceof SpeechCapabilityError) throw error;
        throw failure("tts-failed");
      } finally { isStopped = true; controller.abort(); release(); }
    })();
  };
  return { isSupported: supported, speak, stop };
}
