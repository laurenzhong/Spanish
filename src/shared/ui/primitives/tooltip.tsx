"use client";

import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent, type ReactElement, type ReactNode } from "react";

import { cn, mergeRefs, type PrimitiveTriggerProps } from "./utils";

const TooltipContext = createContext<{ open: boolean; setOpen: (open: boolean) => void; id: string } | null>(null);

export function Tooltip({ children, delayDuration = 300 }: Readonly<{ children: ReactNode; delayDuration?: number }>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const setOpenAfterDelay = (nextOpen: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!nextOpen || delayDuration <= 0) {
      setOpen(nextOpen);
      return;
    }
    timerRef.current = setTimeout(() => setOpen(true), delayDuration);
  };
  return <TooltipContext.Provider value={{ open, setOpen: setOpenAfterDelay, id }}>{children}</TooltipContext.Provider>;
}

export function TooltipTrigger({ children }: Readonly<{ children: ReactElement }>) {
  const context = useContext(TooltipContext);
  if (!context) throw new Error("TooltipTrigger must be used inside Tooltip");
  if (!isValidElement<PrimitiveTriggerProps>(children)) return null;
  const trigger = children as ReactElement<PrimitiveTriggerProps>;
  const open = () => context.setOpen(true);
  const close = () => context.setOpen(false);
  return cloneElement(trigger, {
    "aria-describedby": context.open ? context.id : undefined,
    onFocus: (event: FocusEvent<HTMLElement>) => { trigger.props.onFocus?.(event); open(); },
    onBlur: (event: FocusEvent<HTMLElement>) => { trigger.props.onBlur?.(event); close(); },
    onMouseEnter: (event: MouseEvent<HTMLElement>) => { trigger.props.onMouseEnter?.(event); open(); },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => { trigger.props.onMouseLeave?.(event); close(); },
    ref: mergeRefs(trigger.props.ref),
  });
}

export function TooltipContent({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const context = useContext(TooltipContext);
  if (!context || !context.open) return null;
  return <div {...props} id={context.id} role="tooltip" className={cn("sueno-tooltip-content", className)}>{children}</div>;
}
