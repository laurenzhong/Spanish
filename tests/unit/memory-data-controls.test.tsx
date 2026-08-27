import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryDataControls } from "@/src/modules/profile/ui/memory-data-controls";

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("MemoryDataControls", () => {
  it("shows private memories and removes one after explicit confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { memories: [{ id: "memory-1", characterKey: "lucia", category: "interest", content: "喜欢摄影", createdAt: "2026-08-25T00:00:00.000Z", sensitivity: "normal", shareScope: "private", status: "candidate" }] } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { deleted: true } }) });
    globalThis.fetch = fetchMock;
    window.confirm = vi.fn(() => true);

    render(<MemoryDataControls />);
    await waitFor(() => expect(screen.getByText("喜欢摄影")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除记忆" }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/profile/memories?memoryId=memory-1",
      expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.queryByText("喜欢摄影")).not.toBeInTheDocument());
  });

  it("offers a retry when the private memory list is unavailable", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { memories: [] } }) });
    globalThis.fetch = fetchMock;

    render(<MemoryDataControls />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("目前没有保存的关系记忆。")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
