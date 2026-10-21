import { vi } from "vitest";
import { SpeechCapabilityError } from "@/src/modules/providers/speech/speech-capability";

/** Tests drive preparation, playback and completion independently of a media engine. */
export function createReadAloudFake() {
  type Attempt = {
    text: string;
    lang: string;
    rate: number;
    onstart: ((event?: unknown) => void) | null;
    onend: ((event?: unknown) => void) | null;
    onerror: ((event?: unknown) => void) | null;
  };
  const state = { supported: true, completeImmediately: false };
  const attempts: Attempt[] = [];
  let cancelCurrent: (() => void) | undefined;
  const speak = vi.fn<(attempt: Attempt) => void>();
  const cancel = vi.fn(() => cancelCurrent?.());
  const create = () => ({
    get isSupported() { return state.supported; },
    stop: cancel,
    speak(text: string, options: { languageTag: string; rate?: number; onStart?: () => void }) {
      cancelCurrent?.();
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const end = () => { if (settled) return; settled = true; resolve(); };
        const fail = () => {
          if (settled) return;
          settled = true;
          reject(new SpeechCapabilityError("tts-failed", "朗读暂时不可用，请稍后重试。"));
        };
        cancelCurrent = () => {
          if (settled) return;
          settled = true;
          reject(new SpeechCapabilityError("tts-cancelled", "朗读已停止。"));
        };
        const attempt = {
          text, lang: options.languageTag, rate: options.rate ?? 1,
          onstart: () => { if (!settled) options.onStart?.(); },
          onend: end, onerror: fail,
        };
        attempts.push(attempt);
        speak(attempt);
        if (state.completeImmediately) { attempt.onstart(); end(); }
      });
    },
  });
  const reset = () => {
    attempts.length = 0;
    cancelCurrent = undefined;
    state.supported = true;
    state.completeImmediately = false;
    speak.mockReset();
    cancel.mockClear();
  };
  return { create, state, attempts, speak, cancel, reset };
}

export const readAloudFake = createReadAloudFake();
