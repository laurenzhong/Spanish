import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountDataControls } from "@/src/modules/profile/ui/account-data-controls";

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

afterEach(() => {
  // vitest.config.ts does not enable `globals`, so RTL cannot auto-cleanup.
  cleanup();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("AccountDataControls", () => {
  it("requires confirmation through the shared dialog and reports deferred storage cleanup", async () => {
    const confirmSpy = vi.fn(() => true);
    window.confirm = confirmSpy;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cleanupDeferred: 1 } }),
    });
    globalThis.fetch = fetchMock;

    render(<AccountDataControls />);
    fireEvent.click(screen.getByRole("button", { name: "删除账号数据" }));

    const dialog = await screen.findByRole("alertdialog", { name: "删除我的账号数据？" });
    // The native browser prompt must never be the confirmation path again.
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除账号数据" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/me/data",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmation: "DELETE_MY_DATA" }),
        headers: expect.objectContaining({ "idempotency-key": expect.any(String) }),
      }),
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("部分语音对象");
  });

  it("deletes nothing when the confirmation is dismissed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { sessions: 0, conversations: 0, evidenceEvents: 0, practiceAttempts: 0, relationshipMemories: 0, savedAudio: 0, savedTranscripts: 0 } }),
    });
    globalThis.fetch = fetchMock;

    render(<AccountDataControls />);
    fireEvent.click(screen.getByRole("button", { name: "删除账号数据" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除我的账号数据？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/me/data", expect.objectContaining({ method: "DELETE" }));
  });

  it("keeps the dialog open and claims no success when the server refuses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    globalThis.fetch = fetchMock;

    render(<AccountDataControls />);
    fireEvent.click(screen.getByRole("button", { name: "删除账号数据" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除我的账号数据？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除账号数据" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("没有确认成功前不会删除数据");
    expect(screen.getByRole("alertdialog", { name: "删除我的账号数据？" })).toBeInTheDocument();
  });
});
