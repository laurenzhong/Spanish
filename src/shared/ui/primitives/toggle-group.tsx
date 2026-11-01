"use client";

import { createContext, forwardRef, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type ToggleContextValue = { value?: string; onValueChange?: (value: string) => void; type: "single" | "multiple" };
const ToggleContext = createContext<ToggleContextValue | null>(null);
export function ToggleGroup({ type = "single", value, onValueChange, children, className }: Readonly<{ type?: "single" | "multiple"; value?: string; onValueChange?: (value: string) => void; children: ReactNode; className?: string }>) { return <ToggleContext.Provider value={{ type, value, onValueChange }}><div role="group" className={cn("ui-toggle-group", className)}>{children}</div></ToggleContext.Provider>; }
export const ToggleGroupItem = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { value: string }>(function ToggleGroupItem({ value, className, onClick, ...props }, ref) {
  const context = useContext(ToggleContext);
  const pressed = context?.value === value;
  return <button {...props} ref={ref} type="button" aria-pressed={pressed} className={cn("ui-toggle-group__item", pressed && "is-pressed", className)} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context?.onValueChange?.(value); }}>{props.children}</button>;
});
