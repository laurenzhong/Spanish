"use client";

import type { ReactNode, RefObject } from "react";

type MessageScrollerProps = Readonly<{
  children: ReactNode;
  viewportRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  isNearBottom: boolean;
  hasNewMessage: boolean;
  messageCount: number;
  onJumpToBottom: () => void;
}>;

/**
 * Keeps the message viewport and its recovery affordances together. The
 * conversation feature still owns scroll policy and generation state; this
 * surface only renders the observable scrolling contract.
 */
export function MessageScroller({
  children,
  viewportRef,
  onScroll,
  isNearBottom,
  hasNewMessage,
  messageCount,
  onJumpToBottom,
}: MessageScrollerProps) {
  return (
    <div
      ref={viewportRef}
      className="conversation-thread__messages"
      aria-label="对话消息"
      data-testid="chat-message-scroller"
      onScroll={onScroll}
    >
      {children}
      {!isNearBottom && messageCount > 0 ? (
        <button className="conversation-thread__jump-bottom" type="button" onClick={onJumpToBottom}>
          回到底部 ↓
        </button>
      ) : null}
      {hasNewMessage && !isNearBottom ? (
        <button className="conversation-thread__new-proactive" type="button" onClick={onJumpToBottom}>
          有一条新消息
        </button>
      ) : null}
    </div>
  );
}

type ConversationToastProps = Readonly<{
  message: string | null;
}>;

/** Non-modal feedback that never moves focus away from the active composer. */
export function ConversationToast({ message }: ConversationToastProps) {
  if (!message) return null;
  return (
    <div
      className="conversation-thread__action-notice"
      data-state="visible"
      data-testid="conversation-toast"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
