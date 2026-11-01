"use client";

import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type DropdownContextValue = { open: boolean; setOpen: (open: boolean) => void };
const DropdownContext = createContext<DropdownContextValue | null>(null);
function useDropdown() { const value = useContext(DropdownContext); if (!value) throw new Error("DropdownMenu parts must be inside DropdownMenu"); return value; }

export function DropdownMenu({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: Readonly<{ children: ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }>) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => { if (controlledOpen === undefined) setInternalOpen(next); onOpenChange?.(next); };
  return <DropdownContext.Provider value={{ open, setOpen }}>{children}</DropdownContext.Provider>;
}
export function DropdownMenuTrigger({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { const { open, setOpen } = useDropdown(); return <button {...props} type={props.type ?? "button"} aria-expanded={open} className={cn("ui-dropdown__trigger", className)} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) setOpen(!open); }}>{children}</button>; }
export function DropdownMenuContent({ className, children, align = "start", ...props }: HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  const { open, setOpen } = useDropdown(); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); } }; const onPointer = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); }; document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", onPointer); return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onPointer); }; }, [open, setOpen]);
  if (!open) return null;
  return <div {...props} ref={ref} role="menu" data-align={align} className={cn("ui-dropdown__content", className)}>{children}</div>;
}
export function DropdownMenuItem({ className, onSelect, disabled, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) { const { setOpen } = useDropdown(); return <button {...props} type="button" role="menuitem" disabled={disabled} className={cn("ui-dropdown__item", className)} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) { onSelect?.(); setOpen(false); } }}>{children}</button>; }
