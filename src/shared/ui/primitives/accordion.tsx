"use client";

import { createContext, useContext, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type AccordionContextValue = { open: string | null; setOpen: (value: string | null) => void; collapsible: boolean };
const AccordionContext = createContext<AccordionContextValue | null>(null);
export function Accordion({ children, defaultValue = null, className }: Readonly<{ children: ReactNode; defaultValue?: string | null; className?: string }>) { const [open, setOpen] = useState(defaultValue); return <AccordionContext.Provider value={{ open, setOpen, collapsible: true }}><div className={cn("ui-accordion", className)}>{children}</div></AccordionContext.Provider>; }
export function AccordionItem({ value, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { value: string }) { return <div {...props} data-state={useContext(AccordionContext)?.open === value ? "open" : "closed"} className={cn("ui-accordion__item", className)}>{children}</div>; }
export function AccordionTrigger({ value, children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) { const context = useContext(AccordionContext); const open = context?.open === value; return <button {...props} type="button" aria-expanded={open} className={cn("ui-accordion__trigger", className)} onClick={(event) => { props.onClick?.(event); if (!event.defaultPrevented) context?.setOpen(open ? null : value); }}>{children}</button>; }
export function AccordionContent({ value, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { value: string }) { const open = useContext(AccordionContext)?.open === value; return open ? <div {...props} role="region" className={cn("ui-accordion__content", className)}>{children}</div> : null; }

export function Collapsible({ open: controlledOpen, defaultOpen = false, onOpenChange, children, className }: Readonly<{ open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode | ((args: { open: boolean; setOpen: (open: boolean) => void }) => ReactNode); className?: string }>) { const [internalOpen, setInternalOpen] = useState(defaultOpen); const open = controlledOpen ?? internalOpen; const setOpen = (next: boolean) => { if (controlledOpen === undefined) setInternalOpen(next); onOpenChange?.(next); }; return <div data-state={open ? "open" : "closed"} className={cn("ui-collapsible", className)}>{typeof children === "function" ? children({ open, setOpen }) : children}</div>; }
export function CollapsibleTrigger({ onClick, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} type="button" onClick={onClick} />; }
