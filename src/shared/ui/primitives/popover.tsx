"use client";

import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn, mergeRefs, type PrimitiveTriggerProps, type PrimitiveTriggerRef } from "./utils";

type PopoverContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: PrimitiveTriggerRef;
  contentId: string;
};

const PopoverContext = createContext<PopoverContextValue | null>(null);

type PopoverProps = Readonly<{
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

export function Popover({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentId = useId();
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [controlledOpen, onOpenChange]);
  const contextValue = useMemo(() => ({ open, setOpen, triggerRef, contentId }), [contentId, open, setOpen, triggerRef]);

  return <PopoverContext.Provider value={contextValue}>{children}</PopoverContext.Provider>;
}

export function PopoverTrigger({ children }: Readonly<{ children: ReactElement }>) {
  const context = useContext(PopoverContext);
  if (!context) throw new Error("PopoverTrigger must be used inside Popover");
  if (!isValidElement<PrimitiveTriggerProps>(children)) return null;
  const trigger = children as ReactElement<PrimitiveTriggerProps>;
  return cloneElement(trigger, {
    "aria-expanded": context.open,
    "aria-controls": context.contentId,
    "aria-haspopup": "dialog",
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      if (!event.defaultPrevented) context.setOpen(!context.open);
    },
    ref: mergeRefs(context.triggerRef, trigger.props.ref),
  });
}

export function PopoverContent({ className, children, align = "start", ...props }: React.HTMLAttributes<HTMLDivElement> & Readonly<{ align?: "start" | "end" }>) {
  const context = useContext(PopoverContext);
  const contentRef = useRef<HTMLDivElement>(null);
  if (!context) throw new Error("PopoverContent must be used inside Popover");

  useEffect(() => {
    if (!context.open) return;
    const closeAndRestoreFocus = () => {
      context.setOpen(false);
      context.triggerRef.current?.focus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeAndRestoreFocus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (contentRef.current?.contains(target) || context.triggerRef.current?.contains(target)) return;
      // Prevent the browser's default focus transfer from undoing focus return.
      event.preventDefault();
      closeAndRestoreFocus();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    const focusable = contentRef.current?.querySelector<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])");
    (focusable ?? contentRef.current)?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [context]);

  if (!context.open) return null;
  return <div ref={contentRef} {...props} id={context.contentId} role="dialog" aria-modal="false" data-state="open" data-align={align} className={cn("sueno-popover-content", className)} tabIndex={-1}>{children}</div>;
}

export function PopoverClose({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useContext(PopoverContext);
  if (!context) throw new Error("PopoverClose must be used inside Popover");
  return <button {...props} type={props.type ?? "button"} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) { context.setOpen(false); context.triggerRef.current?.focus(); } }}>{children}</button>;
}
