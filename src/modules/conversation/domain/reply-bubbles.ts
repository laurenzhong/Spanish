/** Authored blank lines carry message boundaries; punctuation and width do not. */
export function splitReplyBubbles(text: string): readonly string[] {
  return text.replace(/\r\n?/gu, "\n").split(/\n[\t ]*\n(?:[\t ]*\n)*/u)
    .map((bubble) => bubble.trim()).filter(Boolean);
}

export const replyBubbleIntervalMs = 450;
