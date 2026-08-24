import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";

describe("ChatThread persistence status", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a visible explanation when conversation history is unavailable", async () => {
    render(<ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />);

    await waitFor(() => {
      expect(screen.getByTestId("conversation-persistence-status")).toHaveTextContent("聊天记录暂未保存");
    });
  });
});
