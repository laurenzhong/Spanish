import type { ReactNode } from "react";
import { cn } from "./utils";

export type BreadcrumbItem = Readonly<{ label: ReactNode; href?: string }>;
export function Breadcrumb({ items, className }: Readonly<{ items: readonly BreadcrumbItem[]; className?: string }>) { return <nav aria-label="面包屑" className={cn("ui-breadcrumb", className)}><ol>{items.map((item, index) => <li key={index}>{item.href && index < items.length - 1 ? <a href={item.href}>{item.label}</a> : <span aria-current={index === items.length - 1 ? "page" : undefined}>{item.label}</span>}{index < items.length - 1 ? <span aria-hidden="true">/</span> : null}</li>)}</ol></nav>; }
