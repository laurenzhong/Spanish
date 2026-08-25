import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountDataControls } from "@/src/modules/profile/ui/account-data-controls";

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("AccountDataControls", () => {
  it("requires confirmation and reports deferred storage cleanup", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { cleanupDeferred: 1 } }),
    });
    globalThis.fetch = fetchMock;
    window.confirm = vi.fn(() => true);

    render(<AccountDataControls />);
    fireEvent.click(screen.getByRole("button", { name: "删除账号数据" }));

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
});
