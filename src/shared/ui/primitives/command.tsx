"use client";

import { useMemo, useState, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type CommandContextValue = { query: string; setQuery: (query: string) => void };
import { createContext, useContext } from "react";
const CommandContext = createContext<CommandContextValue | null>(null);
function useCommand() { const value = useContext(CommandContext); if (!value) throw new Error("Command parts must be inside Command"); return value; }
export function Command({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { const [query, setQuery] = useState(""); return <CommandContext.Provider value={{ query, setQuery }}><div {...props} role="search" className={cn("ui-command", className)}>{children}</div></CommandContext.Provider>; }
export function CommandInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { const { query, setQuery } = useCommand(); return <input {...props} aria-label={props["aria-label"] ?? "搜索"} value={query} onChange={(event) => { props.onChange?.(event); setQuery(event.target.value); }} className={cn("ui-command__input", className)} />; }
export function CommandList({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} role="listbox" className={cn("ui-command__list", className)}>{children}</div>; }
export function CommandEmpty({ children = "没有匹配项", className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cn("ui-command__empty", className)}>{children}</div>; }
export function CommandGroup({ heading, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { heading?: ReactNode }) { return <section {...props} className={cn("ui-command__group", className)}>{heading ? <h3>{heading}</h3> : null}{children}</section>; }
export function CommandItem({ value, children, className, onSelect, ...props }: HTMLAttributes<HTMLDivElement> & { value: string; onSelect?: (value: string) => void }) { const { query } = useCommand(); const normalized = query.trim().toLocaleLowerCase(); const visible = !normalized || value.toLocaleLowerCase().includes(normalized) || (typeof children === "string" && children.toLocaleLowerCase().includes(normalized)); return visible ? <div {...props} role="option" aria-selected={false} tabIndex={0} className={cn("ui-command__item", className)} onClick={() => onSelect?.(value)}>{children}</div> : null; }
export function CommandSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} role="separator" className={cn("ui-command__separator", className)} />; }

export type ComboboxOption = Readonly<{ value: string; label: string; disabled?: boolean }>;
export function Combobox({ options, value, onValueChange, placeholder = "请选择", label = "选择" }: Readonly<{ options: readonly ComboboxOption[]; value?: string; onValueChange?: (value: string) => void; placeholder?: string; label?: string }>) {
  const [query, setQuery] = useState(""); const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value); const filtered = useMemo(() => options.filter((option) => option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [options, query]);
  return <div className="ui-combobox"><button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} className="ui-combobox__trigger" onClick={() => setOpen(!open)}>{selected?.label ?? placeholder}</button>{open ? <div className="ui-combobox__popover"><input autoFocus aria-label={`${label}搜索`} value={query} onChange={(event) => setQuery(event.target.value)} className="ui-combobox__input" /><div role="listbox">{filtered.map((option) => <button key={option.value} type="button" role="option" disabled={option.disabled} aria-selected={option.value === value} onClick={() => { onValueChange?.(option.value); setQuery(""); setOpen(false); }} className="ui-combobox__option">{option.label}</button>)}{filtered.length === 0 ? <p className="ui-combobox__empty">没有匹配项</p> : null}</div></div> : null}</div>;
}
