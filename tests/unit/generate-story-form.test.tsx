import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { GenerateStoryForm } from "@/app/(product)/read/generate/generate-story-form";

describe("GenerateStoryForm", () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    vi.unstubAllGlobals();
  });

  it("validates keyword limits before calling the API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GenerateStoryForm />);
    await user.type(screen.getByLabelText("主题或提示词"), "Una tarde en el mercado");
    await user.type(screen.getByLabelText("关键词（可选）"), "uno, dos, tres, cuatro, cinco, seis, siete, ocho, nueve");
    await user.click(screen.getByRole("button", { name: "Generate Story" }));
    expect(screen.getByRole("alert")).toHaveTextContent("关键词最多 8 个");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the form and opens the private reader on success", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { id: "generated-test@1" } }) }));
    render(<GenerateStoryForm />);
    await user.type(screen.getByLabelText("主题或提示词"), "Una tarde en el mercado");
    await user.selectOptions(screen.getByLabelText("难度"), "A2");
    await user.click(screen.getByRole("button", { name: "Generate Story" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/read/article/generated-test%401"));
  });
});
