import { readFile } from "node:fs/promises";

import { config } from "dotenv";
import { z } from "zod";

import { importMediaSeriesManifest, inspectMediaSeriesManifest } from "../src/modules/media/application/import-media-series";
import { createDrizzleMediaSeriesRepository } from "../src/modules/media/repositories/drizzle-media-series-repository";
import { assertContentWorkflowOwner } from "../src/shared/auth/content-workflow-owner";
import { createDatabaseConnection, type Database } from "../src/shared/db/client";

config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

async function main() {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let apply = false;
  let expectedSha256: string | undefined;
  let ownerUserId: string | undefined;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      if (apply) throw new Error("MEDIA_SERIES_CLI_ARGUMENTS_INVALID");
      apply = true;
    } else if (argument === "--sha256" || argument === "--owner-user-id") {
      const value = args[++index];
      if (!value || value.startsWith("--") || seen.has(argument)) throw new Error("MEDIA_SERIES_CLI_ARGUMENTS_INVALID");
      seen.add(argument);
      if (argument === "--sha256") expectedSha256 = z.string().regex(/^[a-f0-9]{64}$/iu).parse(value);
      else ownerUserId = z.uuid().parse(value);
    } else if (!argument.startsWith("--") && filePath === undefined) filePath = argument;
    else throw new Error("MEDIA_SERIES_CLI_ARGUMENTS_INVALID");
  }
  if (!filePath) throw new Error("MEDIA_SERIES_CLI_FILE_REQUIRED");
  const allowlist = process.env.CONTENT_WORKFLOW_OWNER_USER_IDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (!ownerUserId && allowlist.length === 1) ownerUserId = z.uuid().parse(allowlist[0]);
  if (!ownerUserId) throw new Error("MEDIA_SERIES_CLI_OWNER_REQUIRED");
  ownerUserId = ownerUserId.toLowerCase();
  assertContentWorkflowOwner(ownerUserId);
  const source = await readFile(filePath);
  const inspected = inspectMediaSeriesManifest(source);
  if ((apply && !expectedSha256) || (expectedSha256 && inspected.sha256 !== expectedSha256.toLowerCase())) throw new Error("MEDIA_SERIES_MANIFEST_HASH_MISMATCH");
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString || !/^postgres(?:ql)?:\/\//u.test(connectionString)) throw new Error("MEDIA_SERIES_CLI_DATABASE_URL_REQUIRED");
  const connection = createDatabaseConnection(connectionString);
  try {
    const report = await importMediaSeriesManifest({ source, ownerUserId, mode: apply ? "apply" : "dry-run", expectedSha256 }, {
      transaction: (operation) => connection.db.transaction((transaction) => operation(createDrizzleMediaSeriesRepository(transaction as unknown as Database))),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally { await connection.client.end(); }
}

main().catch((error: unknown) => {
  // Supplier/DB exceptions can embed connection details or user identifiers.
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error ? error.message : "";
  process.stderr.write(`${/^(?:MEDIA_SERIES_[A-Z_]+|CONTENT_WORKFLOW_FORBIDDEN)$/u.test(code) ? code : "MEDIA_SERIES_IMPORT_FAILED"}\n`);
  process.exitCode = 1;
});
