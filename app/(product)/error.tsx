"use client";

import { SurfaceState } from "@/src/shared/ui/surface-state";

type ProductErrorProps = Readonly<{
  reset: () => void;
}>;

export default function ProductError({ reset }: ProductErrorProps) {
  return <SurfaceState action={reset} state="error" />;
}
