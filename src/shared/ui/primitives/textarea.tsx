import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "./utils";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea {...props} ref={ref} className={cn("ui-textarea", className)} />;
});
