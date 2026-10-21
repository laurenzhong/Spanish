"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createReadAloud, readAloudErrorMessage } from "./read-aloud";

export type ReadAloudCallbacks = Readonly<{
  onStart?: () => void; onEnd?: () => void; onError?: (message: string) => void;
}>;
export type ReadAloudState = Readonly<{
  speakingId: string | null; errorMessage: string; clearError: () => void;
  speak: (id: string, text: string, onUnsupported?: () => void, callbacks?: ReadAloudCallbacks) => void;
  stop: () => void;
}>;

/** Synthesized Spanish read-aloud always uses the shared server voice standard. */
export function useReadAloud(languageTag = "es-ES"): ReadAloudState {
  const adapter = useMemo(() => createReadAloud(), []);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; adapter.stop(); }, [adapter]);
  const speak = useCallback((id: string, text: string, onUnsupported?: () => void, callbacks?: ReadAloudCallbacks) => {
    if (!adapter.isSupported) { onUnsupported?.(); return; }
    const attempt = ++generation.current;
    setSpeakingId(id); setErrorMessage("");
    void adapter.speak(text, { languageTag, rate: 1,
      onStart: () => { if (generation.current === attempt) callbacks?.onStart?.(); },
    }).then(() => {
      if (generation.current === attempt) callbacks?.onEnd?.();
    }, (error: unknown) => {
      if (generation.current !== attempt || (error && typeof error === "object" && "code" in error && error.code === "tts-cancelled")) return;
      const message = readAloudErrorMessage(error);
      if (callbacks?.onError) callbacks.onError(message); else setErrorMessage(message);
    }).finally(() => { if (generation.current === attempt) setSpeakingId(null); });
  }, [adapter, languageTag]);
  const stop = useCallback(() => { generation.current++; setSpeakingId(null); adapter.stop(); }, [adapter]);
  const clearError = useCallback(() => setErrorMessage(""), []);
  return { speakingId, errorMessage, speak, stop, clearError };
}
