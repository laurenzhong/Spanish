import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { importCharacterBible } from "../src/modules/characters/application/import-character-bible";
import { createDrizzleCharacterRepository } from "../src/modules/characters/repositories";
import { createDatabaseConnection } from "../src/shared/db/client";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");

const sourcePath = path.resolve(process.cwd(), process.argv[2] ?? "content/characters/lucia.json");
const connection = createDatabaseConnection(connectionString);
try {
  const result = await importCharacterBible(
    createDrizzleCharacterRepository(connection.db),
    JSON.parse(await readFile(sourcePath, "utf8")) as unknown,
  );
  process.stdout.write(`${result.status}: ${result.stableKey}@${result.version} (${result.characterId})\n`);
} finally {
  await connection.client.end();
}
