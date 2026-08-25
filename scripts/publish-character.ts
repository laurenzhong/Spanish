import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { publishCharacterBibles } from "../src/modules/characters/application/publish-character-bible";
import { createDrizzleCharacterRepository } from "../src/modules/characters/repositories";
import { createDatabaseConnection } from "../src/shared/db/client";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");

const requestedPaths = process.argv.slice(2).filter((argument) => argument !== "--");
const sourcePaths = requestedPaths.length > 0
  ? requestedPaths
  : ["lucia.json", "mateo.json", "ines.json"].map((file) => path.join("content", "characters", file));
const sources = await Promise.all(sourcePaths.map(async (sourcePath) =>
  JSON.parse(await readFile(path.resolve(process.cwd(), sourcePath), "utf8")) as unknown,
));

const connection = createDatabaseConnection(connectionString);
try {
  const results = await publishCharacterBibles({
    repository: createDrizzleCharacterRepository(connection.db),
    sources,
  });
  for (const result of results) {
    process.stdout.write(`${result.status}: ${result.character.stableKey}@${result.character.version} (${result.reviews.length} temporary reviews)\n`);
  }
} finally {
  await connection.client.end();
}
