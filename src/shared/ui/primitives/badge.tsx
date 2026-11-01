import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export type BadgeVariant = "default" | "secondary" | "success" | "warning" | "danger" | "outline";
export function Badge({ variant = "default", className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span {...props} className={cn("ui-badge", `ui-badge--${variant}`, className)} />;
}
