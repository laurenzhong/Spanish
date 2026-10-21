import {
  SpeechCapabilityError,
  type SpeechCapabilityErrorCode,
} from "../speech/speech-capability";

export type TextToSpeechOptions = Readonly<{
  languageTag: string;
  rate?: number;
  pitch?: number;
  voiceName?: string;
  voiceURI?: string;
  /** Fired only when the utterance reports an actual start. */
  onStart?: () => void;
  /**
   * How long an utterance may stay without `start` before the engine is treated
   * as silent. Chrome and Safari accept `speak()` for voices that are listed but
   * cannot synthesize, and then never fire `start`, `end` or `error` at all.
   */
  startupTimeoutMs?: number;
  /** Overrides the runtime bound for an utterance whose `end` never arrives. */
  maxRuntimeMs?: number;
}>;

type SpeechSynthesisLike = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices"> & {
  resume?: () => void;
  speaking?: boolean;
  pending?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};
type UtteranceLike = SpeechSynthesisUtterance & {
  onend: ((event: SpeechSynthesisEvent) => void) | null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null;
};

type UtteranceFactory = (text: string) => UtteranceLike;

type SpeechAttempt = Readonly<{
  resolve: () => void;
  reject: (error: SpeechCapabilityError) => void;
}>;

/**
 * How long the engine may stay silent before the utterance is treated as
 * dropped. Chrome/Safari can accept `speak()` for a voice that is listed but
 * cannot synthesize its language pack and then fire no event at all, which used
 * to leave the reader button looking dead forever.
 */
export const defaultTtsStartupTimeoutMs = 2_000;

/**
 * Remote ("online"/network) voices load their audio through the network, so a
 * first utterance can legitimately take several seconds to start.
 */
export const remoteVoiceTtsStartupTimeoutMs = 6_000;

const minTtsStartupTimeoutMs = 50;

function startupTimeoutFor(voice: SpeechSynthesisVoice | null, options: TextToSpeechOptions): number {
  const configured = options.startupTimeoutMs;
  if (configured !== undefined) return Math.max(minTtsStartupTimeoutMs, configured);
  return voice && voice.localService === false ? remoteVoiceTtsStartupTimeoutMs : defaultTtsStartupTimeoutMs;
}

/**
 * Total time budget for an utterance the engine claims to be speaking but that
 * never reports a start. The startup deadline is only the first checkpoint; this
 * is the final one, so a permanently "speaking" engine cannot leave `speak()`
 * unsettled (which is what made the reader button look dead).
 */
function totalStartupBudgetFor(startupTimeoutMs: number): number {
  return startupTimeoutMs + Math.max(startupTimeoutMs, 500);
}

/**
 * Generous upper bound for one utterance that already started but never reports
 * its end, so a stuck engine cannot hold the UI forever. The watcher normally
 * resolves as soon as the engine goes quiet, so this bound must never cut a
 * legitimately long reading short: one second per character is roughly ten times
 * real speaking speed, and short text still gets half a minute.
 */
function maxSpeechRuntimeFor(text: string): number {
  return Math.max(30_000, text.length * 1_000);
}

const endWatcherIntervalMs = 500;

/**
 * Only a failed startup may be retried. A confirmed start prevents replay.
 */
function shouldRetrySilence(error: unknown): boolean {
  return error instanceof SpeechCapabilityError && error.code === "tts-no-audio";
}

/**
 * Queue activity is useful for detecting a missing end after a confirmed start.
 * Chrome sets these flags before audio starts, so they cannot prove audibility.
 */
function engineIsSpeaking(synthesis: SpeechSynthesisLike): boolean {
  return synthesis.speaking === true || synthesis.pending === true;
}

export class BrowserTextToSpeech {
  private active: SpeechAttempt | null = null;
  private generation = 0;

  constructor(
    private readonly synthesis: SpeechSynthesisLike | null,
    private readonly utteranceFactory: UtteranceFactory | null,
  ) {}

  get isSupported(): boolean {
    return this.synthesis !== null && this.utteranceFactory !== null;
  }

  voices(): readonly SpeechSynthesisVoice[] {
    return this.synthesis?.getVoices() ?? [];
  }

  async speak(text: string, options: TextToSpeechOptions): Promise<void> {
    if (!this.isSupported) {
      throw new SpeechCapabilityError(
        "tts-not-supported",
        "This browser cannot speak text.",
      );
    }

    this.stop();
    const generation = this.generation;
    const pinnedVoice = this.selectVoice(options);
    const language = options.languageTag.toLowerCase();
    const alternatives = this.voices()
      .filter((voice) => voice !== pinnedVoice && voice.lang.toLowerCase().startsWith(language.slice(0, 2)))
      .sort((left, right) => Number(Boolean(right.localService)) - Number(Boolean(left.localService)) || Number(right.lang.toLowerCase() === language) - Number(left.lang.toLowerCase() === language));
    // Prefer another real Spanish voice over repeating a broken voice or using
    // the system's default language. Never retry once a start was confirmed.
    const candidates = !pinnedVoice ? [null] : alternatives.length ? [pinnedVoice, ...alternatives.slice(0, 2)] : [pinnedVoice, pinnedVoice, null];
    for (let index = 0; index < candidates.length; index += 1) {
      if (this.generation !== generation) return;
      const voice = candidates[index];
      try {
        await this.utter(text, options, voice, startupTimeoutFor(voice, options));
        return;
      } catch (error) {
        if (this.generation !== generation) return;
        if (!shouldRetrySilence(error) || index === candidates.length - 1) throw error;
      }
    }
  }

  /** Speaks once and resolves on `end`, rejecting on `error` or a silent start. */
  private utter(
    text: string,
    options: TextToSpeechOptions,
    voice: SpeechSynthesisVoice | null,
    startupTimeoutMs: number,
  ): Promise<void> {
    const synthesis = this.synthesis!;
    let utterance: UtteranceLike;
    try {
      utterance = this.utteranceFactory!(text);
      utterance.lang = options.languageTag;
      utterance.rate = clamp(options.rate ?? 0.9, 0.5, 2);
      utterance.pitch = clamp(options.pitch ?? 1, 0, 2);
      if (voice) utterance.voice = voice;
    } catch (error) {
      // Engines have historically thrown from speak()/voice assignment instead
      // of reporting a failure, so callers always receive a rejected promise.
      return Promise.reject(
        new SpeechCapabilityError("tts-failed", error instanceof Error ? error.message : "Text to speech failed."),
      );
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let audioStarted = false;
      let watchdog = 0;
      let elapsedMs = 0;
      let intervalMs = endWatcherIntervalMs;
      const totalStartupBudgetMs = totalStartupBudgetFor(startupTimeoutMs);
      const maxRuntimeMs = options.maxRuntimeMs ?? maxSpeechRuntimeFor(text);
      const clearWatchdog = () => {
        if (watchdog) globalThis.clearTimeout(watchdog);
        watchdog = 0;
      };
      const engineStarted = () => {
        if (settled || this.active !== attempt || audioStarted) return;
        audioStarted = true;
        options.onStart?.();
        // The startup deadline is over, but the end is still outstanding: keep a
        // watcher armed so a dropped `end` can never leave the caller waiting.
        armWatchdog(endWatcherIntervalMs);
      };
      const attempt: SpeechAttempt = {
        resolve: () => {
          if (settled) return;
          settled = true;
          clearWatchdog();
          synthesis.removeEventListener?.("start", engineStarted);
          if (this.active === attempt) this.active = null;
          resolve();
        },
        reject: (error: SpeechCapabilityError) => {
          if (settled) return;
          settled = true;
          clearWatchdog();
          synthesis.removeEventListener?.("start", engineStarted);
          if (this.active === attempt) this.active = null;
          reject(error);
        },
      };
      this.active = attempt;
      // Late evidence of a slow start must never be treated as silence.
      synthesis.addEventListener?.("start", engineStarted);
      utterance.onstart = engineStarted;
      utterance.onend = () => {
        // Some engines finish very short utterances without a separate `start`.
        audioStarted = true;
        attempt.resolve();
      };
      utterance.onerror = (event) =>
        attempt.reject(
          new SpeechCapabilityError(
            !audioStarted && ["synthesis-unavailable", "language-unavailable", "voice-unavailable", "network"].includes(event.error) ? "tts-no-audio" : speechErrorCode(event.error),
            "Text to speech failed.",
          ),
        );
      const armWatchdog = (delayMs: number) => {
        // Re-arming must never leave the previous timer behind.
        clearWatchdog();
        intervalMs = delayMs;
        watchdog = Number(
          globalThis.setTimeout(() => {
            // A newer attempt (or stop()) already moved on; never cancel its audio.
            if (settled || this.active !== attempt) return;
            elapsedMs += intervalMs;
            if (audioStarted) {
              // The engine started but never reported the end (a documented Chrome
              // and Safari defect). Stop once it is silent, or once the runtime
              // bound is reached, so callers are never left waiting forever.
              if (!engineIsSpeaking(synthesis)) {
                attempt.resolve();
                return;
              }
              if (elapsedMs < maxRuntimeMs) {
                armWatchdog(endWatcherIntervalMs);
                return;
              }
              attempt.reject(
                new SpeechCapabilityError("tts-stalled", "Text to speech did not finish."),
              );
              synthesis.cancel();
              return;
            }
            // The engine reports `speaking`, yet no `start` ever arrived. That can
            // be a genuinely slow voice, but Chrome also sets `speaking`
            // synchronously for an utterance it then drops forever, so this may
            // only postpone the verdict: waiting here without a deadline would
            // bring back the "button stuck with no feedback" bug.
            if (engineIsSpeaking(synthesis) && elapsedMs < totalStartupBudgetMs) {
              armWatchdog(totalStartupBudgetMs - elapsedMs);
              return;
            }
            // `speaking` alone is just a queued request in Chrome. Cancel the
            // unstarted request before trying a different voice. Settle first
            // so cancel's synchronous error event cannot change the verdict.
            attempt.reject(new SpeechCapabilityError("tts-no-audio", "Text to speech never started."));
            synthesis.cancel();
          }, delayMs),
        );
      };
      // Chrome can clear `paused` while leaving a previously paused engine
      // silent. Resume after queuing: resume() on an empty queue does nothing.
      // Keep both calls within the click gesture so Safari can authorize audio.
      try {
        synthesis.speak(utterance);
        if (!settled) synthesis.resume?.();
      } catch (error) {
        attempt.reject(
          new SpeechCapabilityError(
            "tts-failed",
            error instanceof Error ? error.message : "Text to speech failed.",
          ),
        );
        return;
      }
      // Only arm the startup deadline when the engine has not already started:
      // `engineStarted` re-arms the end watcher in that case.
      if (!settled && !audioStarted) armWatchdog(startupTimeoutMs);
    });
  }

  stop(): void {
    this.generation += 1;
    const active = this.active;
    this.active = null;
    // Calling cancel() on an idle synthesis queue can silence the very next
    // utterance in Chrome/Safari. Only cancel when this adapter owns an active
    // utterance; a fresh speak should be allowed to enter the queue directly.
    if (active) this.synthesis?.cancel();
    active?.resolve();
  }

  private selectVoice(options: TextToSpeechOptions): SpeechSynthesisVoice | null {
    const language = options.languageTag.toLowerCase();
    const prefix = language.slice(0, 2);
    const voices = this.voices().filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
    return (
      voices.find((voice) => options.voiceURI && voice.voiceURI === options.voiceURI) ??
      voices.find((voice) => options.voiceName && voice.name === options.voiceName) ??
      // Remote ("online") voices can be listed while being unable to synthesize,
      // which the watchdog below would report as silence. A local voice of the
      // same language is the safer default when the caller did not choose one.
      voices.find((voice) => voice.lang.toLowerCase() === language && voice.localService) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix) && voice.localService) ??
      voices.find((voice) => voice.lang.toLowerCase() === language) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix)) ??
      null
    );
  }
}

export const defaultSpanishVoiceName = "Microsoft Elvira Online (Natural) - Spanish (Spain)";
const spanishVoicePreferenceKey = "sueno-reader-tts-voice:es";

/**
 * One shared user-facing wording per failure so every read-aloud button in the
 * product explains the same situation in the same way.
 */
export function textToSpeechErrorMessage(
  error: unknown,
  fallback = "浏览器暂时无法朗读，请稍后再试。",
): string {
  const code = error instanceof SpeechCapabilityError ? error.code : null;
  if (code === "tts-no-audio") {
    return "浏览器没有出声：当前语音可能不可用，可以再点一次或换一个语音。";
  }
  if (code === "tts-stalled") {
    return "朗读中途中断了，可以再点一次继续听。";
  }
  return fallback;
}

export function listBrowserVoices(languageTag = "es-ES"): readonly SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return [];
  const language = languageTag.toLowerCase();
  const prefix = language.slice(0, 2);
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.lang.toLowerCase() === language || voice.lang.toLowerCase().startsWith(prefix))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function readSpanishVoicePreference(): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(spanishVoicePreferenceKey); } catch { return null; }
}

export function writeSpanishVoicePreference(voiceURI: string): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(spanishVoicePreferenceKey, voiceURI); } catch { /* in-memory selection remains usable */ }
}

export function preferredSpanishVoice(voices: readonly SpeechSynthesisVoice[], storedVoiceURI?: string | null): SpeechSynthesisVoice | null {
  // Callers may pass the whole platform list, so only Spanish voices may be
  // considered: falling back to the platform default made a Chinese voice read
  // Spanish words. A stored preference must also be one of these voices.
  const spanish = voices.filter((voice) => voice.lang.toLowerCase().startsWith("es"));
  const stored = spanish.find((voice) =>
    Boolean(storedVoiceURI) &&
    ((voice.voiceURI && voice.voiceURI === storedVoiceURI) || (voice.name && voice.name === storedVoiceURI)),
  );
  return stored ??
    spanish.find((voice) => voice.localService && voice.lang.toLowerCase() === "es-es") ??
    spanish.find((voice) => voice.localService) ??
    spanish.find((voice) => voice.name === defaultSpanishVoiceName) ??
    spanish.find((voice) => voice.name.toLowerCase().includes("elvira")) ??
    spanish[0] ?? null;
}

export function subscribeToBrowserVoices(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") return () => undefined;
  window.speechSynthesis.addEventListener("voiceschanged", onChange);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", onChange);
}

export function createBrowserTextToSpeech(): BrowserTextToSpeech {
  if (
    typeof window === "undefined" ||
    typeof window.speechSynthesis === "undefined" ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    return new BrowserTextToSpeech(null, null);
  }

  return new BrowserTextToSpeech(
    window.speechSynthesis,
    (text) => new SpeechSynthesisUtterance(text),
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function speechErrorCode(error: string): SpeechCapabilityErrorCode {
  return error === "canceled" || error === "interrupted"
    ? "tts-cancelled"
    : "tts-failed";
}
