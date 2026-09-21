import { cn } from "./utils";

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("sueno-select", className)} {...props} />;
}
