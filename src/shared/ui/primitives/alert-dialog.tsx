"use client";

import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { acquireBodyScrollLock, cn, mergeRefs, trapFocus, type PrimitiveTriggerProps, type PrimitiveTriggerRef } from "./utils";

type AlertDialogContextValue = { open: boolean; setOpen: (open: boolean) => void; triggerRef: PrimitiveTriggerRef; contentId: string; titleId: string; descriptionId: string };
const AlertDialogContext = createContext<AlertDialogContextValue | null>(null);

export function AlertDialog({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: Readonly<{ children: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const open = controlledOpen ?? uncontrolledOpen;
  // Keep the callback stable across renders: otherwise every parent re-render
  // changes `setOpen`, which re-runs the content focus effect mid-typing and
  // steals focus from a field (e.g. a confirmation input) after one keystroke.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => { if (controlledOpen === undefined) setUncontrolledOpen(next); onOpenChangeRef.current?.(next); }, [controlledOpen]);
  const contextValue = useMemo(() => ({ open, setOpen, triggerRef, contentId, titleId, descriptionId }), [contentId, descriptionId, open, setOpen, titleId, triggerRef]);
  return <AlertDialogContext.Provider value={contextValue}>{children}</AlertDialogContext.Provider>;
}

export function AlertDialogTrigger({ children }: Readonly<{ children: ReactElement }>) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogTrigger must be used inside AlertDialog");
  if (!isValidElement<PrimitiveTriggerProps>(children)) return null;
  const trigger = children as ReactElement<PrimitiveTriggerProps>;
  return cloneElement(trigger, { "aria-expanded": context.open, "aria-controls": context.contentId, "aria-haspopup": "dialog", onClick: (event: React.MouseEvent<HTMLElement>) => { trigger.props.onClick?.(event); if (!event.defaultPrevented) context.setOpen(true); }, ref: mergeRefs(context.triggerRef, trigger.props.ref) });
}

type AlertDialogContentProps = React.HTMLAttributes<HTMLDivElement> & {
  /** When false (e.g. a server write is in flight), Escape must not close the
   * dialog or move focus back to the trigger. */
  dismissible?: boolean;
};

export function AlertDialogContent({ children, className, dismissible = true, ...props }: AlertDialogContentProps) {
  const context = useContext(AlertDialogContext);
  const contentRef = useRef<HTMLDivElement>(null);
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  if (!context) throw new Error("AlertDialogContent must be used inside AlertDialog");
  const { open, setOpen, triggerRef } = context;
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (!dismissibleRef.current) return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScrollLock = acquireBodyScrollLock();
    document.addEventListener("keydown", onKeyDown);
    (contentRef.current?.querySelector<HTMLElement>("button, input, textarea, a[href]") ?? contentRef.current)?.focus();
    return () => { document.removeEventListener("keydown", onKeyDown); releaseBodyScrollLock(); if (previous && document.contains(previous)) previous.focus(); };
  }, [open, setOpen, triggerRef]);
  if (!open) return null;
  return <div className="sueno-alert-dialog-layer"><div className="sueno-alert-dialog-overlay" aria-hidden="true" /><div {...props} ref={contentRef} id={context.contentId} role="alertdialog" aria-modal="true" aria-labelledby={props["aria-labelledby"] ?? context.titleId} aria-describedby={props["aria-describedby"] ?? context.descriptionId} className={cn("sueno-alert-dialog-content", className)} tabIndex={-1} onKeyDown={(event) => { props.onKeyDown?.(event); if (!event.defaultPrevented) trapFocus(event, contentRef.current); }}>{children}</div></div>;
}

export function AlertDialogTitle({ children, className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogTitle must be used inside AlertDialog");
  return <h2 {...props} id={context.titleId} className={cn("sueno-alert-dialog-title", className)}>{children}</h2>;
}

export function AlertDialogDescription({ children, className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogDescription must be used inside AlertDialog");
  return <p {...props} id={context.descriptionId} className={cn("sueno-alert-dialog-description", className)}>{children}</p>;
}

export function AlertDialogCancel({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogCancel must be used inside AlertDialog");
  return <button {...props} type={props.type ?? "button"} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) { context.setOpen(false); context.triggerRef.current?.focus(); } }}>{children}</button>;
}

export function AlertDialogAction({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(AlertDialogContext);
  if (!context) throw new Error("AlertDialogAction must be used inside AlertDialog");
  return <button {...props} type={props.type ?? "button"} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) { context.setOpen(false); context.triggerRef.current?.focus(); } }}>{children}</button>;
}
