import type { HTMLAttributes } from "react";
import { cn } from "./utils";

export function Separator({ orientation = "horizontal", decorative = true, className, ...props }: HTMLAttributes<HTMLDivElement> & { orientation?: "horizontal" | "vertical"; decorative?: boolean }) {
  return <div {...props} aria-orientation={decorative ? undefined : orientation} role={decorative ? "none" : "separator"} className={cn("ui-separator", `ui-separator--${orientation}`, className)} />;
}
