import type { ReactNode } from "react";
import { cn } from "./utils";

export function EmptyState({ title, description, action, className }: Readonly<{ title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }>) {
  return <section className={cn("ui-empty-state", className)} aria-label={typeof title === "string" ? title : undefined}><div className="ui-empty-state__mark" aria-hidden="true">∅</div><h2>{title}</h2>{description ? <p>{description}</p> : null}{action ? <div className="ui-empty-state__action">{action}</div> : null}</section>;
}
