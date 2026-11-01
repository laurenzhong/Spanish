import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function Progress({ value = 0, label = "进度", className, ...props }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & { value?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return <div {...props} role="progressbar" aria-label={props["aria-label"] ?? label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped} className={cn("ui-progress", className)}><span style={{ width: `${clamped}%` }} /></div>;
}
