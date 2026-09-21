"use client";

import { cloneElement, createContext, isValidElement, useContext, useId, useState, type ReactElement, type ReactNode } from "react";

import { cn } from "./utils";

type TabsContextValue = { value: string; setValue: (value: string) => void; baseId: string };
const TabsContext = createContext<TabsContextValue | null>(null);

export function Tabs({ defaultValue, value: controlledValue, onValueChange, children, className }: Readonly<{ defaultValue: string; value?: string; onValueChange?: (value: string) => void; children: ReactNode; className?: string }>) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const baseId = useId();
  const value = controlledValue ?? uncontrolledValue;
  const setValue = (next: string) => { if (controlledValue === undefined) setUncontrolledValue(next); onValueChange?.(next); };
  return <TabsContext.Provider value={{ value, setValue, baseId }}><div className={cn("sueno-tabs", className)}>{children}</div></TabsContext.Provider>;
}

export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tablist" className={cn("sueno-tabs-list", className)} {...props} />;
}

export function TabsTrigger({ value, children, className, asChild = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & Readonly<{ value: string; asChild?: boolean }>) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be used inside Tabs");
  const tabsContext = context;
  const selected = tabsContext.value === value;
  const tabId = `${tabsContext.baseId}-tab-${value}`;
  const panelId = `${tabsContext.baseId}-panel-${value}`;
  function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role='tab']") ?? []);
    if (!tabs.length) return;
    const index = tabs.indexOf(event.currentTarget);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    const nextValue = tabs[nextIndex]?.getAttribute("data-value");
    if (nextValue) tabsContext.setValue(nextValue);
  }
  const triggerProps = {
    ...props,
    id: tabId,
    role: "tab",
    "aria-selected": selected,
    "aria-controls": props["aria-controls"] ?? panelId,
    tabIndex: selected ? 0 : -1,
    "data-value": value,
    className: cn("sueno-tabs-trigger", selected && "is-active", className),
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      props.onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) tabsContext.setValue(value);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      props.onKeyDown?.(event as React.KeyboardEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) moveFocus(event as React.KeyboardEvent<HTMLButtonElement>);
    },
  };
  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement, triggerProps);
  }
  return <button {...props} type={props.type ?? "button"} {...triggerProps}>{children}</button>;
}

export function TabsContent({ value, children, className, ...props }: React.HTMLAttributes<HTMLDivElement> & Readonly<{ value: string }>) {
  const context = useContext(TabsContext);
  if (!context) throw new Error("TabsContent must be used inside Tabs");
  const selected = context.value === value;
  return <div {...props} id={`${context.baseId}-panel-${value}`} role="tabpanel" aria-labelledby={`${context.baseId}-tab-${value}`} hidden={!selected} data-state={selected ? "active" : "inactive"} className={cn("sueno-tabs-content", className)}>{selected ? children : null}</div>;
}
