import { describe, expect, it, vi } from "vitest";

import { listConversationHistory } from "@/src/modules/conversation/application/list-history";
import type { ConversationRepository } from "@/src/modules/conversation/repositories/conversation-repository";

describe("conversation history withdrawal projection", () => {
  it("does not resurrect an assistant reply linked to a withdrawn user turn", async () => {
    const repository = {
      listMessages: vi.fn().mockResolvedValue([
        {
          id: "10000000-0000-4000-8000-000000000001",
          clientMessageId: "client-1",
          generationId: "generation-1",
          role: "user",
          status: "withdrawn",
          content: "private message",
          replyToMessageId: null,
          createdAt: new Date("2026-09-27T08:00:00.000Z"),
          completedAt: new Date("2026-09-27T08:00:00.000Z"),
        },
        {
          id: "20000000-0000-4000-8000-000000000002",
          clientMessageId: "assistant-1",
          generationId: "generation-1",
          role: "character",
          status: "completed",
          content: "private reply",
          replyToMessageId: "10000000-0000-4000-8000-000000000001",
          createdAt: new Date("2026-09-27T08:00:01.000Z"),
          completedAt: new Date("2026-09-27T08:00:01.000Z"),
        },
      ]),
    };

    await expect(listConversationHistory(repository as unknown as ConversationRepository, "user-1", "lucia")).resolves.toEqual([
      expect.objectContaining({
        id: "10000000-0000-4000-8000-000000000001",
        withdrawn: true,
        text: "",
      }),
    ]);
  });
});
