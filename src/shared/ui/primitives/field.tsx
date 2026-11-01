import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

export function Field({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cn("ui-field", className)} />; }
export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) { return <label {...props} className={cn("ui-field__label", className)} />; }
export function FieldDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) { return <p {...props} className={cn("ui-field__description", className)} />; }
export function FieldError({ children, className, ...props }: HTMLAttributes<HTMLParagraphElement> & { children?: ReactNode }) { return children ? <p {...props} role="alert" className={cn("ui-field__error", className)}>{children}</p> : null; }
