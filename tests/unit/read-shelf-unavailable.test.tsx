import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ReadShelfUnavailable } from "@/app/(product)/read/read-shelf-unavailable";

describe("article library read failure", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("shows an outage separately from an empty library and retries the current URL", () => {
    render(<ReadShelfUnavailable />);

    expect(screen.getByRole("alert")).toHaveTextContent("文章暂时无法读取");
    expect(screen.queryByText(/正在准备中|没有找到匹配|Failed query|select /u)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith();
  });
});
