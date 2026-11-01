import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./utils";

export function PromptBar({ children, className, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <div {...props} className={cn("prompt-bar", className)} role={props.role ?? "group"}>{children}</div>;
}
