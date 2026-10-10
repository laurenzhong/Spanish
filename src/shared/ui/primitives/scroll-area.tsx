import { cn } from "./utils";

export function ScrollArea({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("sueno-scroll-area", className)} {...props} />;
}
