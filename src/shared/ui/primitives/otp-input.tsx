import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "./utils";

export type OtpInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "size" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  label?: ReactNode;
};

/**
 * A small, dependency-free OTP field. The real input remains a single
 * accessible control so browser autofill and keyboard entry continue to work;
 * the slots are a visual treatment only.
 */
export const OtpInput = forwardRef<HTMLInputElement, OtpInputProps>(function OtpInput(
  { value, onChange, length = 6, label, className, id, ...props },
  ref,
) {
  const normalized = value.replace(/\D/gu, "").slice(0, length);
  return (
    <div className={cn("otp-input", className)}>
      {label ? <span className="otp-input__label">{label}</span> : null}
      <div className="otp-input__slots" aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span className={cn("otp-input__slot", index < normalized.length && "is-filled")} key={index}>
            {normalized[index] ?? ""}
          </span>
        ))}
      </div>
      <input
        {...props}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
        autoComplete={props.autoComplete ?? "one-time-code"}
        className="otp-input__field"
        id={id}
        inputMode={props.inputMode ?? "numeric"}
        maxLength={length}
        ref={ref}
        value={normalized}
        onChange={(event) => onChange(event.target.value.replace(/\D/gu, "").slice(0, length))}
      />
    </div>
  );
});
