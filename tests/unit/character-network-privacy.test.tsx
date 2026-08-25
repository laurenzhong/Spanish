import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { SharedMemoryPermissions } from "@/src/modules/character-network/ui/shared-memory-permissions";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("introduction privacy controls", () => {
  it("keeps shareable memories unchecked until the user opts in", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { offers: [{ offerKey: "offer-1", targetCharacterKey: "mateo", reasonText: "共同兴趣", reasonCode: "shared-interest", shareableMemories: [{ id: "memory-1", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: false }] }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { status: "accepted", sharedMemoryIds: ["memory-1"] } }) });
    globalThis.fetch = fetchMock;
    render(<IntroductionInbox />);

    await waitFor(() => expect(screen.getByText("喜欢摄影")).toBeInTheDocument());
    const checkbox = screen.getByRole("checkbox", { name: /喜欢摄影/ });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "同意介绍" }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/character-network/introductions/offer-1",
      expect.objectContaining({ body: JSON.stringify({ decision: "accept", memoryIds: ["memory-1"] }) }),
    ));
  });

  it("revokes a target-specific permission without deleting the memory", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { permissions: [{ id: "memory-1", characterKey: "lucia", targetCharacterKey: "mateo", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: true }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { revoked: true } }) });
    globalThis.fetch = fetchMock;
    render(<SharedMemoryPermissions />);

    await waitFor(() => expect(screen.getByRole("button", { name: "撤销授权" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "撤销授权" }));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/character-network/permissions/memory-1/mateo",
      expect.objectContaining({ method: "DELETE" }),
    ));
  });
});
