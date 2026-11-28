import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntroductionInbox } from "@/src/modules/character-network/ui/introduction-inbox";
import { SharedMemoryPermissions } from "@/src/modules/character-network/ui/shared-memory-permissions";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("introduction privacy controls", () => {
  it("shows a valid Lucía request even when the introductions read fails", async () => {
    let finishIntroductions!: (response: Response) => void;
    const pendingIntroductions = new Promise<Response>((resolve) => { finishIntroductions = resolve; });
    globalThis.fetch = vi.fn(async (input) => String(input).endsWith("/introductions")
      ? pendingIntroductions
      : Response.json({ data: { status: "pending" } }));
    render(<IntroductionInbox />);

    expect(await screen.findByTestId("lucia-contact-request")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "通过申请" })).toBeEnabled();
    finishIntroductions(new Response(null, { status: 503 }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法读取好友介绍");
    expect(screen.getByTestId("lucia-contact-request")).toBeInTheDocument();
    expect(screen.queryByText("目前没有新的介绍请求。")).not.toBeInTheDocument();
  });

  it("keeps shareable memories unchecked until the user opts in", async () => {
    const fetchMock = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/lucia-contact")) return Response.json({ data: { status: "active" } });
      if (url.endsWith("/introductions")) {
        return Response.json({ data: { offers: [{
          offerKey: "offer-1", targetCharacterKey: "mateo", reasonText: "共同兴趣", reasonCode: "shared-interest",
          shareableMemories: [{ id: "memory-1", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: false }],
        }] } });
      }
      return Response.json({ data: { status: "accepted", sharedMemoryIds: ["memory-1"] } });
    });
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

  it("recovers the introduction inbox after a failed request", async () => {
    const readIntroductions = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ data: { offers: [
        { offerKey: "retry-offer", targetCharacterKey: "mateo", reasonText: "共同兴趣", reasonCode: "shared-interest" },
      ] } }));
    globalThis.fetch = vi.fn(async (input) => String(input).endsWith("/introductions")
      ? readIntroductions()
      : Response.json({ data: { status: "active" } }));
    render(<IntroductionInbox />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("Mateo Ruiz")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(readIntroductions).toHaveBeenCalledTimes(2);
  });

  it("recovers shared permissions after a failed request", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { permissions: [{ id: "retry-memory", characterKey: "lucia", targetCharacterKey: "mateo", category: "interest", content: "喜欢摄影", sensitivity: "normal", alreadyShared: true }] } }),
      });
    globalThis.fetch = fetchMock;
    render(<SharedMemoryPermissions />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByText("喜欢摄影")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
