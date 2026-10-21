import type { ConversationState } from "../domain/conversation-state";
import { splitReplyBubbles } from "../domain/reply-bubbles";

export { splitReplyBubbles as replyBubbles } from "../domain/reply-bubbles";

export type PendingUserMessage = Readonly<{
  text: string;
  clientMessageId: string;
  assistance?: "translation";
}>;

export const pendingReplyDebounceMs = 120;
export const maxPendingUserMessages = 20;

/** Recover only the unanswered tail; authored greetings and proactive messages do not answer it. */
export function recoverPendingReply(state: ConversationState) {
  let boundary = -1;
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index]!;
    if (message.role === "character" && message.complete && message.status !== "cancelled"
      && message.sourceType !== "authored_opening" && message.sourceType !== "proactive") {
      boundary = index;
      break;
    }
  }
  const tail = state.messages.slice(boundary + 1);
  const messages: PendingUserMessage[] = tail.filter((message) => message.role === "user" && !message.withdrawn)
    .map((message) => ({ text: message.text, clientMessageId: message.clientMessageId ?? message.id,
      ...(message.sourceType === "translation_assisted" ? { assistance: "translation" as const } : {}) }));
  const prefix = tail.findLast((message) => message.role === "character" && !message.withdrawn && Boolean(message.generationId)
    && (!message.complete || message.status === "cancelled"));
  return { messages, prefix, supersedes: prefix?.generationId ? visibleReplyPrefix(state, prefix.generationId) : null };
}

/** Only count text this client actually applied, never a candidate from a request body. */
export function visibleReplyPrefix(state: ConversationState, generationId: string): Readonly<{ generationId: string; visibleBubbleCount: number }> {
  return {
    generationId,
    visibleBubbleCount: state.messages.filter((message) => message.role === "character" && message.generationId === generationId && !message.withdrawn)
      .reduce((total, message) => total + splitReplyBubbles(message.text).length, 0),
  };
}
