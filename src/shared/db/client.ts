import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

type DatabaseConnection = {
  client: ReturnType<typeof postgres>;
  db: Database;
};

const globalDatabase = globalThis as typeof globalThis & {
  spanishDatabaseConnection?: DatabaseConnection;
};

function readDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required on the server. Copy .env.example to a local .env file and provide a Supabase PostgreSQL connection string.",
    );
  }

  if (!/^postgres(?:ql)?:\/\//u.test(connectionString)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }

  return connectionString;
}

export function createDatabaseConnection(
  connectionString: string,
): DatabaseConnection {
  const client = postgres(connectionString, {
    prepare: false,
    max: process.env.NODE_ENV === "development" ? 5 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return {
    client,
    db: drizzle(client, { schema }),
  };
}

export function getDatabase(): Database {
  if (!globalDatabase.spanishDatabaseConnection) {
    globalDatabase.spanishDatabaseConnection = createDatabaseConnection(
      readDatabaseUrl(),
    );
  }

  return globalDatabase.spanishDatabaseConnection.db;
}
