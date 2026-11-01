import type { HTMLAttributes } from "react";

import { cn } from "./utils";

export type ScrollProgressProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  value: number;
  label?: string;
};

export function ScrollProgress({ value, label = "阅读进度", className, ...props }: ScrollProgressProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      {...props}
      aria-label={props["aria-label"] ?? label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={clamped}
      className={cn("scroll-progress", className)}
      role="progressbar"
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
