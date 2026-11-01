import { forwardRef, type LabelHTMLAttributes } from "react";
import { cn } from "./utils";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(function Label({ className, ...props }, ref) {
  return <label {...props} ref={ref} className={cn("ui-label", className)} />;
});
