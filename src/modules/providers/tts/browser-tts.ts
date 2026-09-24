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
}>;

type SpeechSynthesisLike = Pick<SpeechSynthesis, "speak" | "cancel" | "getVoices"> & {
  resume?: () => void;
};
type UtteranceLike = SpeechSynthesisUtterance & {
  onend: ((event: SpeechSynthesisEvent) => void) | null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null;
};

type UtteranceFactory = (text: string) => UtteranceLike;

export class BrowserTextToSpeech {
  private active: {
    resolve: () => void;
    reject: (error: SpeechCapabilityError) => void;
  } | null = null;

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

  speak(text: string, options: TextToSpeechOptions): Promise<void> {
    if (!this.isSupported) {
      return Promise.reject(
        new SpeechCapabilityError(
          "tts-not-supported",
          "This browser cannot speak text.",
        ),
      );
    }

    this.stop();
    const utterance = this.utteranceFactory!(text);
    utterance.lang = options.languageTag;
    utterance.rate = clamp(options.rate ?? 0.9, 0.5, 2);
    utterance.pitch = clamp(options.pitch ?? 1, 0, 2);
    const voice = this.selectVoice(options);
    if (voice) utterance.voice = voice;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const attempt = {
        resolve: () => {
          if (settled) return;
          settled = true;
          if (this.active === attempt) this.active = null;
          resolve();
        },
        reject: (error: SpeechCapabilityError) => {
          if (settled) return;
          settled = true;
          if (this.active === attempt) this.active = null;
          reject(error);
        },
      };
      this.active = attempt;
      utterance.onend = () => attempt.resolve();
      utterance.onerror = (event) =>
        attempt.reject(
          new SpeechCapabilityError(
            speechErrorCode(event.error),
            "Text to speech failed.",
          ),
        );
      // Chrome and Safari can leave the synthesis queue paused after a page
      // switch or an interrupted utterance. Resume before enqueueing the next
      // user-triggered utterance so both the reader and chat stay audible.
      this.synthesis!.resume?.();
      this.synthesis!.speak(utterance);
    });
  }

  stop(): void {
    const active = this.active;
    this.active = null;
    // Calling cancel() on an idle synthesis queue can silence the very next
    // utterance in Chrome/Safari. Only cancel when this adapter owns an active
    // utterance; a fresh speak should be allowed to enter the queue directly.
    if (active) this.synthesis?.cancel();
    active?.resolve();
  }

  private selectVoice(options: TextToSpeechOptions): SpeechSynthesisVoice | null {
    const voices = this.voices();
    return (
      voices.find((voice) => options.voiceURI && voice.voiceURI === options.voiceURI) ??
      voices.find((voice) => voice.name === options.voiceName) ??
      voices.find((voice) => voice.lang.toLowerCase() === options.languageTag.toLowerCase()) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith(options.languageTag.slice(0, 2).toLowerCase())) ??
      null
    );
  }
}

export const defaultSpanishVoiceName = "Microsoft Elvira Online (Natural) - Spanish (Spain)";
const spanishVoicePreferenceKey = "sueno-reader-tts-voice:es";

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
  return voices.find((voice) => storedVoiceURI && (voice.voiceURI === storedVoiceURI || voice.name === storedVoiceURI)) ??
    voices.find((voice) => voice.name === defaultSpanishVoiceName) ??
    voices.find((voice) => voice.name.toLowerCase().includes("elvira") && voice.lang.toLowerCase().startsWith("es")) ??
    voices[0] ?? null;
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
