import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConversationToast, MessageScroller } from "@/src/modules/conversation/ui/chat-surface";

describe("chat shared surfaces", () => {
  it("keeps jump and proactive actions in the message scroller contract", () => {
    const onJumpToBottom = vi.fn();
    const viewportRef = { current: null };
    render(
      <MessageScroller
        viewportRef={viewportRef}
        onScroll={vi.fn()}
        isNearBottom={false}
        hasNewMessage
        messageCount={2}
        onJumpToBottom={onJumpToBottom}
      >
        <p>消息内容</p>
      </MessageScroller>,
    );

    expect(screen.getByTestId("chat-message-scroller")).toHaveAttribute("aria-label", "对话消息");
    fireEvent.click(screen.getByRole("button", { name: "回到底部 ↓" }));
    fireEvent.click(screen.getByRole("button", { name: "有一条新消息" }));
    expect(onJumpToBottom).toHaveBeenCalledTimes(2);
  });

  it("uses one atomic polite status surface for non-modal feedback", () => {
    render(<ConversationToast message="已复制消息" />);
    const toast = screen.getByTestId("conversation-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveAttribute("aria-atomic", "true");
    expect(toast).toHaveTextContent("已复制消息");
  });
});
