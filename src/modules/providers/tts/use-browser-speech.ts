"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createBrowserTextToSpeech,
  preferredSpanishVoice,
  readSpanishVoicePreference,
  textToSpeechErrorMessage,
} from "./browser-tts";

export type BrowserSpeechState = Readonly<{
  /** Id of the entry currently being spoken, or null when nothing is speaking. */
  speakingId: string | null;
  errorMessage: string;
  clearError: () => void;
  speak: (id: string, text: string, onUnsupported?: () => void) => void;
  stop: () => void;
}>;

/**
 * Read-aloud for a list of Spanish entries (words, saved phrases, chat replies).
 *
 * The browser engine can accept `speak()` and then stay completely silent: the
 * selected voice may be listed while its language pack cannot synthesize. The
 * adapter behind this hook watches for that case and rejects with
 * `tts-no-audio`, so a button can never look dead with no explanation.
 */
export function useBrowserSpeech(languageTag = "es-ES"): BrowserSpeechState {
  const textToSpeech = useMemo(() => createBrowserTextToSpeech(), []);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const generationRef = useRef(0);

  useEffect(() => () => {
    generationRef.current += 1;
    textToSpeech.stop();
  }, [textToSpeech]);

  const speak = useCallback((id: string, text: string, onUnsupported?: () => void) => {
    if (!textToSpeech.isSupported) {
      onUnsupported?.();
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setSpeakingId(id);
    setErrorMessage("");
    const voices = textToSpeech.voices();
    // preferredSpanishVoice() already falls back to the preferred Elvira voice and
    // refuses stored values that are not among the offered Spanish voices.
    const voice = preferredSpanishVoice(voices, readSpanishVoicePreference());
    void textToSpeech
      .speak(text, { languageTag, rate: 0.88, voiceName: voice?.name, voiceURI: voice?.voiceURI })
      .then(
        () => undefined,
        (error: unknown) => {
          if (generationRef.current !== generation) return;
          setErrorMessage(textToSpeechErrorMessage(error));
        },
      )
      .finally(() => {
        if (generationRef.current !== generation) return;
        setSpeakingId((current) => (current === id ? null : current));
      });
  }, [languageTag, textToSpeech]);

  const stop = useCallback(() => {
    generationRef.current += 1;
    setSpeakingId(null);
    textToSpeech.stop();
  }, [textToSpeech]);

  const clearError = useCallback(() => setErrorMessage(""), []);

  return { speakingId, errorMessage, clearError, speak, stop };
}
