import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoiceDataControls } from "@/src/modules/profile/ui/voice-data-controls";

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;

afterEach(() => {
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
  vi.restoreAllMocks();
});

describe("VoiceDataControls", () => {
  it("lists saved voice data and deletes a transcript after confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {
          audio: [{ id: "00000000-0000-4000-8000-000000000071", createdAt: "2026-08-25T00:00:00.000Z", durationMs: 2400, mimeType: "audio/webm", purpose: "milestone", retentionPolicy: "milestone", sizeBytes: 1024 }],
          transcripts: [{ attemptId: "00000000-0000-4000-8000-000000000072", createdAt: "2026-08-25T00:00:00.000Z", text: "¿Cómo va todo?" }],
        } }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { deleted: true } }) });
    globalThis.fetch = fetchMock;
    window.confirm = vi.fn(() => true);

    render(<VoiceDataControls />);
    await waitFor(() => expect(screen.getByText("¿Cómo va todo?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "删除转写" }));

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/profile/media?kind=transcript&id=00000000-0000-4000-8000-000000000072",
      expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.queryByText("¿Cómo va todo?")).not.toBeInTheDocument());
  });
});
