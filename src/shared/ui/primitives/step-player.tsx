import type { ReactNode } from "react";

import { cn } from "./utils";

export type StepPlayerStep = Readonly<{
  id: string;
  label: string;
  state?: "completed" | "current" | "upcoming";
  description?: ReactNode;
}>;

export function StepPlayer({ steps, className, label = "学习步骤" }: Readonly<{ steps: readonly StepPlayerStep[]; className?: string; label?: string }>) {
  return (
    <nav aria-label={label} className={cn("step-player", className)}>
      <ol>
        {steps.map((step, index) => {
          const state = step.state ?? "upcoming";
          return (
            <li aria-current={state === "current" ? "step" : undefined} className={cn("step-player__step", `is-${state}`)} data-state={state} key={step.id}>
              <span aria-hidden="true" className="step-player__marker">{state === "completed" ? "✓" : index + 1}</span>
              <span className="step-player__copy">
                <span className="step-player__label">{step.label}</span>
                {step.description ? <span className="step-player__description">{step.description}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
