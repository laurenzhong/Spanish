import { defineConfig, devices } from "@playwright/test";

const e2ePort = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
if (!Number.isInteger(e2ePort) || e2ePort < 1024 || e2ePort > 65_535) {
  throw new Error("PLAYWRIGHT_PORT must be an integer between 1024 and 65535.");
}
const e2eBaseURL = `http://127.0.0.1:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  workers: 2,
  use: {
    baseURL: e2eBaseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"], channel: "chrome" },
    },
  ],
  webServer: {
    // Keep E2E isolated from the developer's long-running server on port 3000.
    command: `pnpm exec next dev --hostname 127.0.0.1 --port ${e2ePort}`,
    env: {
      ...process.env,
      AUTH_E2E_ENABLED: "1",
      // Keep E2E deterministic and prevent accidental writes to the local .env database.
      DATABASE_URL: "",
      NEXT_DIST_DIR: ".next/e2e",
    },
    url: e2eBaseURL,
    reuseExistingServer: false,
  },
});
