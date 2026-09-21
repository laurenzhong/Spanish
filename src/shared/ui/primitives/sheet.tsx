"use client";

import { cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";

import { acquireBodyScrollLock, cn, mergeRefs, trapFocus, type PrimitiveTriggerProps, type PrimitiveTriggerRef } from "./utils";

type SheetContextValue = { open: boolean; setOpen: (open: boolean) => void; triggerRef: PrimitiveTriggerRef; contentId: string; titleId: string };
const SheetContext = createContext<SheetContextValue | null>(null);

export function Sheet({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: Readonly<{ children: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }>) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();
  const titleId = useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback((next: boolean) => { if (controlledOpen === undefined) setUncontrolledOpen(next); onOpenChange?.(next); }, [controlledOpen, onOpenChange]);
  const contextValue = useMemo(() => ({ open, setOpen, triggerRef, contentId, titleId }), [contentId, open, setOpen, titleId, triggerRef]);
  return <SheetContext.Provider value={contextValue}>{children}</SheetContext.Provider>;
}

export function SheetTrigger({ children }: Readonly<{ children: ReactElement }>) {
  const context = useContext(SheetContext);
  if (!context) throw new Error("SheetTrigger must be used inside Sheet");
  if (!isValidElement<PrimitiveTriggerProps>(children)) return null;
  const trigger = children as ReactElement<PrimitiveTriggerProps>;
  return cloneElement(trigger, { "aria-expanded": context.open, "aria-controls": context.contentId, "aria-haspopup": "dialog", onClick: (event: React.MouseEvent<HTMLElement>) => { trigger.props.onClick?.(event); if (!event.defaultPrevented) context.setOpen(true); }, ref: mergeRefs(context.triggerRef, trigger.props.ref) });
}

export function SheetContent({ children, className, side = "right", ...props }: React.HTMLAttributes<HTMLDivElement> & Readonly<{ side?: "top" | "right" | "bottom" | "left" }>) {
  const context = useContext(SheetContext);
  const contentRef = useRef<HTMLDivElement>(null);
  if (!context) throw new Error("SheetContent must be used inside Sheet");
  useEffect(() => {
    if (!context.open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key !== "Escape") return; event.preventDefault(); context.setOpen(false); context.triggerRef.current?.focus(); };
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBodyScrollLock = acquireBodyScrollLock();
    document.addEventListener("keydown", onKeyDown);
    const focusable = contentRef.current?.querySelector<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])");
    (focusable ?? contentRef.current)?.focus();
    return () => { document.removeEventListener("keydown", onKeyDown); releaseBodyScrollLock(); if (previous && document.contains(previous)) previous.focus(); };
  }, [context]);
  if (!context.open) return null;
  return <div className="sueno-sheet-layer" data-state="open"><button type="button" className="sueno-sheet-overlay" aria-label="关闭面板" onClick={() => { context.setOpen(false); context.triggerRef.current?.focus(); }} /><div {...props} ref={contentRef} id={context.contentId} role="dialog" aria-modal="true" aria-labelledby={props["aria-labelledby"] ?? context.titleId} data-state="open" data-side={side} className={cn("sueno-sheet-content", className)} tabIndex={-1} onKeyDown={(event) => { props.onKeyDown?.(event); if (!event.defaultPrevented) trapFocus(event, contentRef.current); }}>{children}</div></div>;
}

export function SheetTitle({ children, className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const context = useContext(SheetContext);
  if (!context) throw new Error("SheetTitle must be used inside Sheet");
  return <h2 {...props} id={context.titleId} className={cn("sueno-sheet-title", className)}>{children}</h2>;
}

export function SheetClose({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(SheetContext);
  if (!context) throw new Error("SheetClose must be used inside Sheet");
  return <button {...props} type={props.type ?? "button"} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) { context.setOpen(false); context.triggerRef.current?.focus(); } }}>{children}</button>;
}
