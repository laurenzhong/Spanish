import type { HTMLAttributes } from "react";
import { cn } from "./utils";

function part(name: string) {
  return function CardPart({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props} className={cn(`ui-card__${name}`, className)} />; };
}
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <section {...props} className={cn("ui-card", className)} />; }
export const CardHeader = part("header");
export const CardTitle = part("title");
export const CardDescription = part("description");
export const CardContent = part("content");
export const CardFooter = part("footer");
