import "dotenv/config";

import { defineConfig } from "drizzle-kit";

const localSupabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DIRECT_DATABASE_URL ??
      process.env.DATABASE_URL ??
      localSupabaseUrl,
  },
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
  strict: true,
  verbose: true,
});
