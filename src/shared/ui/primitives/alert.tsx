import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export function Alert({ variant = "default", title, children, className, ...props }: HTMLAttributes<HTMLDivElement> & { variant?: "default" | "success" | "warning" | "danger"; title?: ReactNode }) {
  return <div {...props} role={props.role ?? (variant === "danger" ? "alert" : "status")} className={cn("ui-alert", `ui-alert--${variant}`, className)}>{title ? <strong>{title}</strong> : null}{children ? <div>{children}</div> : null}</div>;
}
