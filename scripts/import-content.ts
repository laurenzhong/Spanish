import "dotenv/config";

import { importContentBundle } from "../src/modules/content/import/import-content";
import { createDatabaseConnection } from "../src/shared/db/client";
import {
  readContentFile,
  requireContentFileArgument,
} from "./content-file";

const connectionString =
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DIRECT_DATABASE_URL or DATABASE_URL is required for content import.",
  );
}

const filePath = requireContentFileArgument();
const connection = createDatabaseConnection(connectionString);

try {
  const result = await importContentBundle(
    connection.db,
    await readContentFile(filePath),
  );
  process.stdout.write(
    `${result.status}: ${result.bundleKey}@${result.bundleVersion} (${result.contentHash})\n`,
  );
} finally {
  await connection.client.end();
}
