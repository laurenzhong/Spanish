import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
  pending: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: mocks.prefetch }),
}));

vi.mock("next/link", () => ({
  default: ({ children, prefetch, ...props }: { children?: ReactNode; prefetch?: boolean | null } & Record<string, unknown>) => (
    <a {...props} data-prefetch={prefetch === false ? "disabled" : prefetch === true ? "full" : "auto"}>{children}</a>
  ),
  useLinkStatus: () => ({ pending: mocks.pending }),
}));

import { MediaCardLink } from "@/src/modules/media/ui/media-card-link";

const HREF = "/learn/media/youtube.language-reactor.demo";

function renderLink(children: ReactNode = <h2>Una charla en el café</h2>) {
  return render(
    <MediaCardLink className="media-card__link" href={HREF}>
      {children}
    </MediaCardLink>,
  );
}

beforeEach(() => {
  mocks.prefetch.mockClear();
  mocks.pending = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("media card intent prefetch link", () => {
  it("keeps the card href, its accessible name and Link's default auto prefetch behaviour", () => {
    const { container } = renderLink();

    const link = screen.getByRole("link", { name: "Una charla en el café" });
    expect(link).toHaveAttribute("href", HREF);
    // The wrapper must not opt out of Next's own viewport prefetching.
    expect(link).toHaveAttribute("data-prefetch", "auto");
    expect(link).toContainElement(container.querySelector(".media-card__pending"));
  });

  it("warms the destination after a short hover delay, using the default auto strategy", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Una charla en el café" });
    vi.useFakeTimers();

    fireEvent.pointerEnter(link);
    vi.advanceTimersByTime(99);
    expect(mocks.prefetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);
    expect(mocks.prefetch).toHaveBeenCalledWith(HREF, expect.objectContaining({ kind: "auto", onInvalidate: expect.any(Function) }));
  });

  it("cancels a scheduled warm-up when the pointer leaves before the delay", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Una charla en el café" });
    vi.useFakeTimers();

    fireEvent.pointerEnter(link);
    vi.advanceTimersByTime(60);
    fireEvent.pointerLeave(link);
    vi.advanceTimersByTime(1_000);
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });

  it("prefetches a given href only once until the entry is invalidated", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Una charla en el café" });
    vi.useFakeTimers();

    fireEvent.pointerEnter(link);
    vi.advanceTimersByTime(100);
    fireEvent.pointerLeave(link);
    fireEvent.pointerEnter(link);
    vi.advanceTimersByTime(100);
    fireEvent.focus(link);
    fireEvent.touchStart(link);
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);
  });

  it("treats keyboard focus and a touch start as immediate intent", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Una charla en el café" });
    vi.useFakeTimers();

    fireEvent.focus(link);
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);

    const other = render(
      <MediaCardLink href="/learn/media/podcast.demo">
        <h2>Radio de barrio</h2>
      </MediaCardLink>,
    );
    fireEvent.touchStart(other.getByRole("link", { name: "Radio de barrio" }));
    expect(mocks.prefetch).toHaveBeenCalledTimes(2);
    expect(mocks.prefetch).toHaveBeenLastCalledWith("/learn/media/podcast.demo", expect.objectContaining({ kind: "auto" }));
  });

  it("allows another prefetch after Next invalidates the cached entry", () => {
    renderLink();
    const link = screen.getByRole("link", { name: "Una charla en el café" });
    vi.useFakeTimers();

    fireEvent.focus(link);
    expect(mocks.prefetch).toHaveBeenCalledTimes(1);
    const options = mocks.prefetch.mock.calls[0]?.[1] as { onInvalidate?: () => void } | undefined;
    expect(options?.onInvalidate).toBeTypeOf("function");
    options?.onInvalidate?.();
    fireEvent.focus(link);
    expect(mocks.prefetch).toHaveBeenCalledTimes(2);
  });

  it("shows a lightweight pending indicator from useLinkStatus", () => {
    mocks.pending = true;
    const { container } = renderLink();

    const dot = container.querySelector(".media-card__pending");
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute("data-pending", "true");
    expect(screen.getByText("正在打开…")).toHaveClass("sr-only");
  });

  it("keeps the pending indicator invisible when the navigation is not pending", () => {
    const { container } = renderLink();
    const dot = container.querySelector(".media-card__pending");
    expect(dot).not.toBeNull();
    expect(dot).not.toHaveAttribute("data-pending");
  });
});
