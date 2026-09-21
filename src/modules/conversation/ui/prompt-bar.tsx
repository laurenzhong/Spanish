"use client";

import { VoiceComposer, type VoiceComposerProps } from "./voice-composer";

/** Stable feature boundary for text/voice prompting; stream state stays in ChatThread. */
export type PromptBarProps = VoiceComposerProps;

export function PromptBar(props: PromptBarProps) {
  return <VoiceComposer {...props} />;
}
