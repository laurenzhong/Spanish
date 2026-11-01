"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export const Switch = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean; onCheckedChange?: (checked: boolean) => void }>(function Switch({ checked = false, onCheckedChange, className, onClick, ...props }, ref) {
  return <button {...props} ref={ref} type="button" role="switch" aria-checked={checked} className={cn("ui-switch", checked && "is-checked", className)} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) onCheckedChange?.(!checked); }}><span aria-hidden="true" /></button>;
});
