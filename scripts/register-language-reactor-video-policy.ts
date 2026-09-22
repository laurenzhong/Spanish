import "dotenv/config";

import { pathToFileURL } from "node:url";
import { createDrizzleContentAcquisitionRepository, registerContentSource } from "../src/modules/content-acquisition";
import { languageReactorRightsPolicySchema } from "../src/modules/content-acquisition/adapters";
import { createDatabaseConnection } from "../src/shared/db/client";

const SOURCE = "language-reactor.youtube-mix-es";
const CONFIRMATION = "I_HAVE_AUTHORIZATION";

export async function enableLanguageReactorVideoProcessing() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== CONFIRMATION) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  const value = process.env.LANGUAGE_REACTOR_VIDEO_TEMPORARY_MEDIA_PROCESSING?.trim().toLowerCase() || "yt-dlp";
  if (value !== "disabled" && value !== "yt-dlp") throw new Error("LANGUAGE_REACTOR_VIDEO_TEMPORARY_MEDIA_PROCESSING_INVALID");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) throw new Error("DATABASE_URL_REQUIRED");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    const source = await repository.findSourceByStableKey(SOURCE);
    if (!source || source.adapterType !== "language-reactor" || source.sourceKind !== "video-channel") throw new Error("LANGUAGE_REACTOR_VIDEO_SOURCE_NOT_FOUND");
    const policy = languageReactorRightsPolicySchema.parse(source.rightsPolicy ?? {});
    const updated = await registerContentSource(repository, {
      id: source.id,
      stableKey: source.stableKey,
      adapterType: source.adapterType,
      sourceKind: source.sourceKind,
      externalSourceId: source.externalSourceId,
      displayName: source.displayName,
      language: source.language,
      region: source.region,
      enabled: source.enabled,
      rightsStatus: source.rightsStatus,
      rightsPolicy: { ...policy, temporaryMediaProcessing: value },
      schedule: { mode: "daily" },
      rateLimit: { requestsPerMinute: 10 },
      cursor: source.cursor,
    });
    return { stableKey: updated.stableKey, temporaryMediaProcessing: value };
  } finally {
    await connection.client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  enableLanguageReactorVideoProcessing()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "LANGUAGE_REACTOR_VIDEO_POLICY_UPDATE_FAILED"}\n`); process.exitCode = 1; });
}
