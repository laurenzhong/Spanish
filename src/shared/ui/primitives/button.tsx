import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger" | "loading";
export type ButtonSize = "sm" | "md" | "lg";
export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "primary", size = "md", loading = false, disabled, className, children, ...props }, ref) {
  return <button {...props} ref={ref} className={cn("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)} disabled={disabled || loading} aria-busy={loading || undefined}>
    {loading ? <span aria-hidden="true" className="ui-button__spinner" /> : null}{children}
  </button>;
});
