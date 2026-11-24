"use client";

import { forwardRef, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "./utils";
import styles from "./otp-input.module.css";

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
  { value, onChange, length = 6, label, className, id, onClick, onFocus, onKeyUp, onSelect, ...props },
  ref,
) {
  const normalized = value.replace(/\D/gu, "").slice(0, length);
  const slots = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ start: normalized.length, end: normalized.length });
  const start = Math.min(selection.start, normalized.length);
  const end = Math.min(selection.end, normalized.length);
  const caretIndex = Math.min(end, length - 1);
  const caret = end === length ? "after" : end < normalized.length ? "before" : "empty";

  function syncSelection(input: HTMLInputElement) {
    setSelection({
      start: input.selectionStart ?? input.value.length,
      end: input.selectionEnd ?? input.value.length,
    });
  }

  return (
    <div className={cn("otp-input", styles.root, className)}>
      {label ? <span className="otp-input__label">{label}</span> : null}
      <div ref={slots} className={cn("otp-input__slots", styles.slots)} aria-hidden="true">
        {Array.from({ length }, (_, index) => (
          <span
            className={cn("otp-input__slot", styles.slot, index < normalized.length && "is-filled")}
            data-caret={start === end && index === caretIndex ? caret : undefined}
            data-selected={index >= start && index < end ? "true" : undefined}
            key={index}
          >
            {normalized[index] ?? ""}
          </span>
        ))}
      </div>
      <input
        {...props}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
        autoComplete={props.autoComplete ?? "one-time-code"}
        className={cn("otp-input__field", styles.field)}
        id={id}
        inputMode={props.inputMode ?? "numeric"}
        maxLength={length}
        ref={ref}
        value={normalized}
        onChange={(event) => {
          const input = event.currentTarget;
          const next = input.value.replace(/\D/gu, "").slice(0, length);

          if (next !== input.value) {
            const position = input.value.slice(0, input.selectionEnd ?? input.value.length).replace(/\D/gu, "").length;
            input.value = next;
            input.setSelectionRange(position, position);
          }

          syncSelection(input);
          onChange(next);
        }}
        onFocus={(event) => {
          syncSelection(event.currentTarget);
          onFocus?.(event);
        }}
        onKeyUp={(event) => {
          // Keyboard navigation also needs to update an input focused before hydration.
          syncSelection(event.currentTarget);
          onKeyUp?.(event);
        }}
        onSelect={(event) => {
          syncSelection(event.currentTarget);
          onSelect?.(event);
        }}
        onClick={(event) => {
          const input = event.currentTarget;
          if (slots.current && event.detail === 1 && !event.shiftKey && input.selectionStart === input.selectionEnd) {
            // The native input spans the row, so place pointer clicks by the visible slot positions.
            const index = Array.from(slots.current.children).findIndex((slot) => {
              const { left, width } = slot.getBoundingClientRect();
              return event.clientX < left + width / 2;
            });
            const position = index < 0 ? normalized.length : Math.min(index, normalized.length);
            input.setSelectionRange(position, position);
          }
          syncSelection(input);
          onClick?.(event);
        }}
      />
    </div>
  );
});
