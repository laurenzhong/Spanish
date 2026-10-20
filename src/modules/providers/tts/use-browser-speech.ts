"use client";

/** @deprecated Use useReadAloud. This entry also uses the shared server voice. */
export { useReadAloud as useBrowserSpeech } from "./use-read-aloud";
/** @deprecated Use ReadAloudCallbacks / ReadAloudState. */
export type {
  ReadAloudCallbacks as BrowserSpeechCallbacks,
  ReadAloudState as BrowserSpeechState,
} from "./use-read-aloud";
