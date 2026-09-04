import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    // Windows CI/dev machines have limited V8/WASM address space; one worker
    // keeps the full suite deterministic instead of crashing with Zone OOM.
    maxWorkers: 1,
  },
});
