import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast, type ToastInput } from "@/src/shared/ui/toast";

function Trigger({ toast }: Readonly<{ toast: ToastInput }>) {
  const { push } = useToast();
  return <button onClick={() => push(toast)} type="button">触发</button>;
}

function renderToast(toast: ToastInput) {
  return render(<ToastProvider><Trigger toast={toast} /></ToastProvider>);
}

function open(toast: ToastInput) {
  renderToast(toast);
  fireEvent.click(screen.getByRole("button", { name: "触发" }));
}

describe("toast layer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("announces the message politely without moving focus", () => {
    renderToast({ message: "已收藏。" });

    const trigger = screen.getByRole("button", { name: "触发" });
    trigger.focus();
    fireEvent.click(trigger);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("已收藏。");
    expect(status).toHaveAttribute("aria-live", "polite");
    // Toasts must never steal focus from what the reader was doing.
    expect(trigger).toHaveFocus();
  });

  it("dismisses itself inside the 3-5s guidance", () => {
    open({ message: "已取消收藏。" });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(3_999); });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("can be dismissed by hand", () => {
    open({ message: "已同步。", durationMs: 0 });

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("runs the undo action and closes the toast that offered it", () => {
    const onSelect = vi.fn();
    open({ message: "已收藏。", action: { label: "撤销", onSelect }, durationMs: 0 });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps only the most recent toasts on screen", () => {
    function MultiTrigger() {
      const { push } = useToast();
      return <button
        onClick={() => {
          for (const message of ["第一条", "第二条", "第三条", "第四条"]) push({ message, durationMs: 0 });
        }}
        type="button"
      >触发</button>;
    }
    render(<ToastProvider><MultiTrigger /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "触发" }));

    // Four pushes, at most three visible: the oldest is dropped.
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("第一条")).not.toBeInTheDocument();
    expect(screen.getByText("第四条")).toBeInTheDocument();
  });

  it("shows a pending action while its promise is in flight and dismisses once it settles", async () => {
    let resolveAction: (() => void) | undefined;
    const onSelect = vi.fn(() => new Promise<void>((resolve) => { resolveAction = () => resolve(); }));
    open({
      message: "已收藏。",
      action: { label: "撤销", pendingLabel: "撤销中…", onSelect },
      durationMs: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));

    const pending = screen.getByRole("button", { name: "撤销中…" });
    expect(pending).toBeDisabled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    // The toast survives the request it is reporting on.
    expect(screen.getByRole("status")).toHaveTextContent("已收藏。");

    await act(async () => { resolveAction?.(); });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("activates a pending action once even when it is clicked twice in the same tick", () => {
    const onSelect = vi.fn(() => new Promise<void>(() => undefined));
    open({
      message: "已收藏。",
      action: { label: "撤销", pendingLabel: "撤销中…", onSelect },
      durationMs: 0,
    });

    const action = screen.getByRole("button", { name: "撤销" });
    // Both clicks land before React can re-render the button as disabled, so the
    // in-flight guard — not the DOM state — is what has to stop the second one.
    act(() => { action.click(); action.click(); });

    const pending = screen.getByRole("button", { name: "撤销中…" });
    expect(pending).toBeDisabled();
    expect(onSelect).toHaveBeenCalledTimes(1);

    // A later click on the now-disabled button is inert as well.
    fireEvent.click(pending);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("holds an auto-dismissing toast open while an action is pending", async () => {
    let resolveAction: (() => void) | undefined;
    const onSelect = vi.fn(() => new Promise<void>((resolve) => { resolveAction = () => resolve(); }));
    open({ message: "已收藏。", action: { label: "撤销", pendingLabel: "撤销中…", onSelect } });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("status").querySelector(".sueno-toast__countdown")).toHaveClass("is-pending");

    // The countdown must not close a toast whose reversal is still running.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("status")).toBeInTheDocument();

    await act(async () => { resolveAction?.(); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("re-enables the action with a fresh countdown when it rejects", async () => {
    let rejectAction: ((reason?: unknown) => void) | undefined;
    const onSelect = vi.fn(() => new Promise<void>((_, reject) => { rejectAction = reject; }));
    open({
      message: "已收藏。",
      action: { label: "撤销", pendingLabel: "撤销中…", onSelect },
      durationMs: 3_000,
    });

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(screen.getByRole("button", { name: "撤销中…" })).toBeDisabled();

    await act(async () => { rejectAction?.(new Error("undo-failed")); });

    // A failed reversal has to leave something the reader can use or dismiss.
    const action = screen.getByRole("button", { name: "撤销" });
    expect(action).toBeEnabled();
    expect(screen.getByRole("status").querySelector(".sueno-toast__countdown")).not.toHaveClass("is-pending");

    act(() => { vi.advanceTimersByTime(3_000); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders a countdown bar only on a toast that dismisses itself", () => {
    open({ message: "已收藏。", durationMs: 3_000 });

    const status = screen.getByRole("status");
    const countdown = status.querySelector<HTMLElement>(".sueno-toast__countdown");
    expect(countdown).not.toBeNull();
    expect(status).toContainElement(countdown);
    expect(countdown).toHaveAttribute("role", "presentation");
    expect(countdown).toHaveAttribute("aria-hidden", "true");
    expect(countdown).toHaveStyle({ animationDuration: "3000ms" });
  });

  it("renders no countdown bar when the toast waits for the reader", () => {
    open({ message: "已取消收藏。", durationMs: 0 });

    expect(screen.getByRole("status").querySelector(".sueno-toast__countdown")).toBeNull();
  });
});
