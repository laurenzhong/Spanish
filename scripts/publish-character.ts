import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { publishCharacterBibles } from "../src/modules/characters/application/publish-character-bible";
import { createDrizzleCharacterRepository } from "../src/modules/characters/repositories";
import type { CharacterBible } from "../src/modules/characters/schemas";
import { createDatabaseConnection } from "../src/shared/db/client";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");

const requestedArguments = process.argv.slice(2).filter((argument) => argument !== "--");
// `--current=<path>` names the revision a source supersedes, positionally
// matched to the sources. A version above 1 needs it: the publish gate compares
// the candidate against the revision it replaces.
const currentPaths = requestedArguments
  .filter((argument) => argument.startsWith("--current="))
  .map((argument) => argument.slice("--current=".length));
const sourcePaths = requestedArguments.filter((argument) => !argument.startsWith("--"));
const resolvedSourcePaths = sourcePaths.length > 0
  ? sourcePaths
  : ["lucia.json", "mateo.json", "ines.json"].map((file) => path.join("content", "characters", file));
const readJson = async (relativePath: string): Promise<unknown> =>
  JSON.parse(await readFile(path.resolve(process.cwd(), relativePath), "utf8")) as unknown;
const sources = await Promise.all(resolvedSourcePaths.map(readJson));
const currentRevisions = (await Promise.all(currentPaths.map(readJson))) as readonly CharacterBible[];

const connection = createDatabaseConnection(connectionString);
try {
  const results = await publishCharacterBibles({
    repository: createDrizzleCharacterRepository(connection.db),
    sources,
    ...(currentRevisions.length > 0 ? { currentRevisions } : {}),
  });
  for (const result of results) {
    process.stdout.write(`${result.status}: ${result.character.stableKey}@${result.character.version} (${result.reviews.length} temporary reviews)\n`);
  }
} finally {
  await connection.client.end();
}
