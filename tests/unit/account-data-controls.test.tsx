import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountDataControls } from "@/src/modules/profile/ui/account-data-controls";
import { AccountSecurityControls } from "@/src/modules/profile/ui/account-security-controls";
import { createSupabaseBrowserClient } from "@/src/shared/auth/browser";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/src/shared/auth/browser", () => ({
  createSupabaseBrowserClient: vi.fn(),
}));

const browserClientMock = vi.mocked(createSupabaseBrowserClient);
const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
const originalSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalSupabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

function accountSummary(role: "owner" | "member" = "member", accountStatus = "active"): Response {
  return jsonResponse({ apiVersion: "v1", data: { role, accountStatus } });
}

/** Route-aware fetch fake: GET /api/v1/me for the summary plus a per-test handler. */
function installFetch(handler: (request: { url: string; init?: RequestInit }) => Promise<Response> | Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "/api/v1/me") return accountSummary();
    return handler({ url, init });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  browserClientMock.mockReset();
  browserClientMock.mockReturnValue(null);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
  // jsdom does not implement the object-URL download path; the component only
  // hands a Blob to the browser, so a stub is enough to assert the wiring.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(() => "blob:sueno-export"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalSupabaseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalSupabaseKey;
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

describe("AccountSecurityControls", () => {
  it("shows the read-only account role and status from /api/v1/me", async () => {
    installFetch(() => jsonResponse({}));
    render(<AccountSecurityControls />);

    const facts = await screen.findByTestId("account-security-facts");
    expect(within(facts).getByText("账号角色").tagName).toBe("DT");
    expect(within(facts).getByText("普通用户")).toBeVisible();
    expect(within(facts).getByText("账号状态")).toBeVisible();
    expect(within(facts).getByText("正常")).toBeVisible();
    expect(screen.getByRole("heading", { name: "账号角色、数据导出与登录会话" })).toBeVisible();
  });

  it("downloads the export blob with the server filename", async () => {
    const clickSpy = vi.mocked(HTMLAnchorElement.prototype.click);
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    const revokeObjectUrl = vi.mocked(URL.revokeObjectURL);
    const fetchMock = installFetch(() => jsonResponse(
      { exportVersion: "1" },
      200,
      { "content-disposition": 'attachment; filename="sueno-account-export.json"' },
    ));

    render(<AccountSecurityControls />);
    await screen.findByTestId("account-security-facts");
    fireEvent.click(screen.getByRole("button", { name: "导出我的数据" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/me/export",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    expect(await screen.findByRole("status")).toHaveTextContent("数据导出已开始下载。");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).toHaveBeenCalledOnce();
    // The temporary download anchor is always removed from the document.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("keeps the export failure visible and retries in place", async () => {
    let exportAttempts = 0;
    installFetch(() => {
      exportAttempts += 1;
      return exportAttempts === 1
        ? jsonResponse({ error: { code: "EXPORT_UNAVAILABLE" } }, 503)
        : jsonResponse({ exportVersion: "1" }, 200);
    });

    render(<AccountSecurityControls />);
    await screen.findByTestId("account-security-facts");
    fireEvent.click(screen.getByRole("button", { name: "导出我的数据" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("数据导出暂时不可用，请稍后重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("status")).toHaveTextContent("数据导出已开始下载。");
    expect(exportAttempts).toBe(2);
  });

  it("signs out every device only after confirmation and returns to login", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    browserClientMock.mockReturnValue({ auth: { signOut } } as never);
    installFetch(() => jsonResponse({}));
    const user = userEvent.setup();

    render(<AccountSecurityControls />);
    await user.click(screen.getByRole("button", { name: "退出全部设备" }));
    const dialog = await screen.findByRole("alertdialog", { name: "退出全部设备？" });
    expect(signOut).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "退出全部设备" }));

    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(replace).toHaveBeenCalledWith("/login");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps the sign-out dialog open when the auth service fails", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: new Error("network") });
    browserClientMock.mockReturnValue({ auth: { signOut } } as never);
    installFetch(() => jsonResponse({}));
    const user = userEvent.setup();

    render(<AccountSecurityControls />);
    await user.click(screen.getByRole("button", { name: "退出全部设备" }));
    const dialog = await screen.findByRole("alertdialog", { name: "退出全部设备？" });
    await user.click(within(dialog).getByRole("button", { name: "退出全部设备" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("退出全部设备未完成");
    expect(replace).not.toHaveBeenCalled();
  });

  it("disables the global sign-out when Supabase is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    installFetch(() => jsonResponse({}));

    render(<AccountSecurityControls />);

    expect(await screen.findByText("当前环境尚未配置 Supabase Auth，此操作不可用。")).toBeVisible();
    expect(screen.getByRole("button", { name: "退出全部设备" })).toBeDisabled();
  });

  it("requires the typed confirmation phrase before deleting the account", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    browserClientMock.mockReturnValue({ auth: { signOut } } as never);
    let deleteInit: RequestInit | undefined;
    installFetch(({ url, init }) => {
      if (url === "/api/v1/me/account") {
        deleteInit = init;
        return jsonResponse({ apiVersion: "v1", data: { deleted: true, alreadyDeleted: false } });
      }
      return jsonResponse({});
    });
    const user = userEvent.setup();

    render(<AccountSecurityControls />);
    await user.click(screen.getByRole("button", { name: "注销账号" }));
    const dialog = await screen.findByRole("alertdialog", { name: "注销我的账号？" });
    const confirm = within(dialog).getByRole("button", { name: "永久注销账号" });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText("确认短语"), "delete my account");
    expect(confirm).toBeDisabled();

    await user.clear(within(dialog).getByLabelText("确认短语"));
    await user.type(within(dialog).getByLabelText("确认短语"), "DELETE MY ACCOUNT");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(deleteInit?.method).toBe("DELETE");
    expect(deleteInit?.headers).toEqual(expect.objectContaining({
      "content-type": "application/json",
      "idempotency-key": expect.any(String),
    }));
    expect(deleteInit?.body).toBe(JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("keeps the deletion dialog open with safe copy when the server refuses", async () => {
    installFetch(({ url }) => url === "/api/v1/me/account"
      ? jsonResponse({ error: { code: "ACCOUNT_PROVISIONING_FAILED" } }, 503)
      : jsonResponse({}));
    const user = userEvent.setup();

    render(<AccountSecurityControls />);
    await user.click(screen.getByRole("button", { name: "注销账号" }));
    const dialog = await screen.findByRole("alertdialog", { name: "注销我的账号？" });
    await user.type(within(dialog).getByLabelText("确认短语"), "DELETE MY ACCOUNT");
    await user.click(within(dialog).getByRole("button", { name: "永久注销账号" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "注销暂时未完成，账号和数据没有删除。请稍后重试。",
    );
    expect(screen.getByRole("alertdialog", { name: "注销我的账号？" })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
