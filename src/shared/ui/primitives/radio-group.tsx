"use client";

import { createContext, useContext, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "./utils";

type RadioContextValue = { name?: string; value?: string; onValueChange?: (value: string) => void };
const RadioContext = createContext<RadioContextValue | null>(null);
export function RadioGroup({ name, value, onValueChange, children, className }: Readonly<{ name?: string; value?: string; onValueChange?: (value: string) => void; children: ReactNode; className?: string }>) { return <RadioContext.Provider value={{ name, value, onValueChange }}><div role="radiogroup" className={cn("ui-radio-group", className)}>{children}</div></RadioContext.Provider>; }
export function RadioGroupItem({ value, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { value: string }) { const context = useContext(RadioContext); return <input {...props} type="radio" name={props.name ?? context?.name} value={value} checked={props.checked ?? context?.value === value} onChange={(event) => { props.onChange?.(event); if (event.target.checked) context?.onValueChange?.(value); }} className={cn("ui-radio", className)} />; }
