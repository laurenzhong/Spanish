"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Minimal toast layer for the actions that used to end in a dead end.
 *
 * Contract:
 * - every toast is its own polite live region, so a screen reader announces it
 *   without moving focus;
 * - toasts never steal focus and never block the page;
 * - a toast that carries an action is the only way a reversible server action
 *   offers "undo", and choosing it closes the toast after the action settles;
 * - an action that returns a promise puts its toast into a pending state: the
 *   button is disabled, switches to `pendingLabel` and ignores further clicks,
 *   so a reversible action cannot be re-armed into a ping-pong of toasts while
 *   its request is still running;
 * - auto-dismiss stays inside the 3–5s guidance unless a caller overrides it,
 *   and a toast that dismisses itself shows a decorative countdown bar.
 */
export type ToastAction = Readonly<{
  label: string;
  onSelect: () => void | Promise<void>;
  /** Copy for the action button while the promise it returned is in flight. */
  pendingLabel?: string;
}>;

export type ToastInput = Readonly<{
  message: string;
  action?: ToastAction;
  durationMs?: number;
}>;

type ToastRecord = ToastInput & Readonly<{
  id: number;
  /** True while the selected action is in flight. */
  pending: boolean;
  /** Bumped when the countdown restarts, so the bar animation remounts. */
  cycle: number;
}>;

const ToastContext = createContext<{ push: (toast: ToastInput) => void } | null>(null);

/**
 * Components that show a toast are also rendered on their own in unit tests and
 * in isolated previews, where no provider exists. Those renders must not crash,
 * so a missing provider degrades to a no-op instead of throwing.
 */
const noopToast = { push: () => undefined };

const defaultDurationMs = 4_000;
const maxVisibleToasts = 3;
const defaultPendingLabel = "处理中…";

function isThenable(action: void | Promise<void>): action is Promise<void> {
  return typeof (action as Promise<void> | undefined)?.then === "function";
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, number>());
  const durationsRef = useRef(new Map<number, number>());
  // Double activation is guarded here and not only by the rendered `disabled`
  // attribute: two clicks inside one tick both read the pre-pending state, so
  // only a ref that flips synchronously can stop the callback from running
  // twice (which is exactly what let the undo action re-arm itself).
  const pendingIdsRef = useRef(new Set<number>());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    durationsRef.current.delete(id);
    pendingIdsRef.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, [clearTimer]);

  const armTimer = useCallback((id: number, duration: number) => {
    clearTimer(id);
    if (duration > 0) {
      timersRef.current.set(id, window.setTimeout(() => dismiss(id), duration));
    }
  }, [clearTimer, dismiss]);

  const push = useCallback((toast: ToastInput) => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    const duration = toast.durationMs ?? defaultDurationMs;
    durationsRef.current.set(id, duration);
    setToasts((current) => [...current, { ...toast, id, pending: false, cycle: 0 }].slice(-maxVisibleToasts));
    armTimer(id, duration);
  }, [armTimer]);

  const selectAction = useCallback((id: number, action: ToastAction) => {
    if (pendingIdsRef.current.has(id)) return;

    let outcome: void | Promise<void>;
    try {
      outcome = action.onSelect();
    } catch {
      // A synchronous failure behaves like a rejection: the toast stays usable
      // and keeps whatever auto-dismiss timer it already had.
      return;
    }

    // Synchronous actions settle immediately, so they keep the original
    // behaviour: select and close in the same tick, with no pending flash.
    if (!isThenable(outcome)) {
      dismiss(id);
      return;
    }

    pendingIdsRef.current.add(id);
    // An action in flight must outlive the countdown: an auto-dismiss here would
    // close the toast halfway through the request it is reporting on.
    clearTimer(id);
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, pending: true } : toast)));

    outcome.then(
      () => {
        pendingIdsRef.current.delete(id);
        dismiss(id);
      },
      () => {
        pendingIdsRef.current.delete(id);
        const duration = durationsRef.current.get(id);
        // Already dismissed (closed by hand, or replaced by newer toasts): there
        // is nothing left to re-enable and no timer to restart.
        if (duration === undefined) return;
        setToasts((current) => current.map((toast) => (
          toast.id === id ? { ...toast, pending: false, cycle: toast.cycle + 1 } : toast
        )));
        armTimer(id, duration);
      },
    );
  }, [armTimer, clearTimer, dismiss]);

  // Timers are cleared on unmount; the viewport below is rendered client-side
  // only, and only while something is actually queued for the reader.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const contextValue = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && typeof document !== "undefined"
        ? createPortal(
          <div className="sueno-toast-viewport">
            {toasts.map((toast) => {
              const action = toast.action;
              const duration = toast.durationMs ?? defaultDurationMs;
              return (
                <div className="sueno-toast" key={toast.id} role="status" aria-live="polite">
                  <p className="sueno-toast__message">{toast.message}</p>
                  {action
                    ? <button
                      className="sueno-toast__action"
                      aria-busy={toast.pending ? true : undefined}
                      disabled={toast.pending}
                      onClick={() => selectAction(toast.id, action)}
                      type="button"
                    >{toast.pending ? action.pendingLabel ?? defaultPendingLabel : action.label}</button>
                    : null}
                  <button aria-label="关闭提示" className="sueno-toast__close" onClick={() => dismiss(toast.id)} type="button">×</button>
                  {duration > 0
                    ? <span
                      aria-hidden="true"
                      className={`sueno-toast__countdown${toast.pending ? " is-pending" : ""}`}
                      key={`${toast.id}:${toast.cycle}`}
                      role="presentation"
                      style={{ animationDuration: `${duration}ms` }}
                    />
                    : null}
                </div>
              );
            })}
          </div>,
          document.body,
        )
        : null}
    </ToastContext.Provider>
  );
}

export function useToast(): { push: (toast: ToastInput) => void } {
  return useContext(ToastContext) ?? noopToast;
}
