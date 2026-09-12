import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsPanel } from "@/src/modules/providers/ui/provider-settings-panel";

const response = {
  apiVersion: "v1",
  data: {
    capabilities: [{
      capability: "scenario-roleplay",
      selectedProviderKey: null,
      selectedProviderAvailable: true,
      effectiveProviderKey: "minimax",
      canAutoSwitch: false,
      providers: [
        { key: "minimax", label: "MiniMax", configured: true, status: "healthy", lastSuccessAt: "2026-09-12T07:00:00.000Z", lastFailureAt: null },
        { key: "openai", label: "OpenAI", configured: false, status: "unavailable", lastSuccessAt: null, lastFailureAt: null },
      ],
    }],
  },
};

describe("provider settings panel", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows accessible loading, status, and unavailable choices", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })));
    render(<ProviderSettingsPanel />);
    expect(screen.getByRole("region", { name: "Provider 设置" })).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByRole("heading", { name: "临时人物回复" })).toBeInTheDocument();
    expect(screen.getByText("运行正常")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OpenAI（未配置）" })).toBeDisabled();
  });

  it("persists a selection and announces success without losing focus", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify({ apiVersion: "v1", data: { preference: { capability: "scenario-roleplay", providerKey: "minimax" } } }), { status: 200 });
      return new Response(JSON.stringify(response), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsPanel />);
    const select = await screen.findByRole("combobox", { name: "临时人物回复 Provider" });
    select.focus();
    await act(async () => { fireEvent.change(select, { target: { value: "minimax" } }); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/me/provider-preferences", expect.objectContaining({ method: "PATCH" })));
    expect(await screen.findByText("临时人物回复设置已保存。")).toBeInTheDocument();
    expect(select).toHaveFocus();
  });

  it("offers an inline retry when status loading fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    render(<ProviderSettingsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取 Provider 状态");
    expect(screen.getByRole("button", { name: "重新加载 Provider 状态" })).toBeInTheDocument();
  });
});
