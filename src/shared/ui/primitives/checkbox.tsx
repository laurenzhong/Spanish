"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "./utils";

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type">>(function Checkbox({ className, ...props }, ref) {
  return <span className={cn("ui-checkbox", className)}><input {...props} ref={ref} type="checkbox" /><span aria-hidden="true" className="ui-checkbox__mark">✓</span></span>;
});
