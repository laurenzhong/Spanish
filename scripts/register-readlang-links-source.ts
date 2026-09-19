import "dotenv/config";

import { pathToFileURL } from "node:url";

import policyJson from "@/content/source-policies/readlang-links-v2.json";
import {
  createDrizzleContentAcquisitionRepository,
  registerContentSource,
} from "@/src/modules/content-acquisition";
import { readlangLinksPolicySchema } from "@/src/modules/content-acquisition/adapters/readlang/readlang-links-policy";
import { createDatabaseConnection } from "@/src/shared/db/client";

const SOURCE_ID = "5e246020-3905-4f6c-9106-22a2b0aa2b0b";
const STABLE_KEY = "readlang.links.es";

export function createReadlangLinksSourceInput() {
  const policy = readlangLinksPolicySchema.parse(policyJson);
  return {
    id: SOURCE_ID,
    stableKey: STABLE_KEY,
    adapterType: "readlang-links" as const,
    sourceKind: "article-site" as const,
    externalSourceId: policy.sourceUrl,
    displayName: "Readlang Spanish authorized links",
    language: "es",
    region: "ES",
    enabled: true,
    rightsStatus: "verified" as const,
    rightsPolicy: policy,
    schedule: { mode: "daily", policyVersion: policy.policyVersion },
    rateLimit: { requestsPerMinute: 10 },
    cursor: null,
  };
}
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const source = await registerContentSource(
      createDrizzleContentAcquisitionRepository(connection.db),
      createReadlangLinksSourceInput(),
    );
    process.stdout.write(`${JSON.stringify({ stableKey: source.stableKey, policyVersion: source.rightsPolicy?.policyVersion, enabled: source.enabled, rightsStatus: source.rightsStatus })}\n`);
  } finally {
    await connection.client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Failed to register the Readlang source."}\n`);
    process.exitCode = 1;
  });
}
