import type { HTMLAttributes } from "react";

import { cn } from "./utils";

export type AiStatusState = "idle" | "thinking" | "success" | "error";

export type AiStatusProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  state?: AiStatusState;
  label?: string;
  live?: boolean;
};

const defaultLabels: Record<AiStatusState, string> = {
  idle: "就绪",
  thinking: "Typing",
  success: "已完成",
  error: "暂时失败",
};

/** Small semantic status cue for assistant work; it does not own any request state. */
export function AiStatus({ state = "thinking", label, live = false, className, ...props }: AiStatusProps) {
  const text = label ?? defaultLabels[state];
  return (
    <span
      {...props}
      aria-live={live ? "polite" : undefined}
      className={cn("ai-status", `ai-status--${state}`, className)}
      data-state={state}
      role={live ? "status" : undefined}
    >
      <span className="ai-status__label">{text}</span>
      {state === "thinking" ? <span aria-hidden="true" className="ai-status__dots"><i /><i /><i /></span> : null}
    </span>
  );
}
