import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

import base from "../../playwright.config";

const server = base.webServer;
if (!server || Array.isArray(server)) throw new Error("Expected one isolated E2E server");

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "read-library-unavailable.spec.ts",
  metadata: { ...base.metadata, articleDatabaseUnavailable: true },
  webServer: {
    ...server,
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    env: {
      ...server.env,
      // Loopback failure exercises the real repository without reading or
      // writing the developer's configured database or calling providers.
      DATABASE_URL: "postgresql://unavailable:unavailable@127.0.0.1:1/unavailable",
      DIRECT_DATABASE_URL: "",
    },
  },
});
