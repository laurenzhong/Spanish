import "dotenv/config";

import { pathToFileURL } from "node:url";

import {
  createDrizzleContentAcquisitionRepository,
  registerContentSource,
} from "../src/modules/content-acquisition";
import { languageReactorRightsPolicySchema } from "../src/modules/content-acquisition/adapters";
import { createDatabaseConnection } from "../src/shared/db/client";

const PODCAST_SOURCE = "language-reactor.podcast-mix-es";
const confirmation = "I_HAVE_AUTHORIZATION";

function configuredHosts(): string[] {
  return [...new Set((process.env.LANGUAGE_REACTOR_PODCAST_AUDIO_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean))];
}

export async function updateLanguageReactorPodcastAudioHosts() {
  if (process.env.MEDIA_VIDEO_HOSTING_CONFIRM !== confirmation) throw new Error("MEDIA_AUTHORIZATION_REQUIRED");
  const hosts = configuredHosts();
  if (hosts.length === 0) throw new Error("LANGUAGE_REACTOR_PODCAST_AUDIO_HOSTS_REQUIRED");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) throw new Error("DATABASE_URL_REQUIRED");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    const source = await repository.findSourceByStableKey(PODCAST_SOURCE);
    if (!source || source.adapterType !== "language-reactor" || source.sourceKind !== "podcast-feed") throw new Error("LANGUAGE_REACTOR_PODCAST_SOURCE_NOT_FOUND");
    const policy = languageReactorRightsPolicySchema.parse(source.rightsPolicy ?? {});
    const nextPolicy = { ...policy, allowedAudioHosts: [...new Set([...policy.allowedAudioHosts, ...hosts])] };
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
      rightsPolicy: nextPolicy,
      schedule: { mode: "daily" },
      rateLimit: { requestsPerMinute: 10 },
      cursor: process.env.LANGUAGE_REACTOR_PODCAST_RESET_CURSOR === "true" ? null : source.cursor,
    });
    return { stableKey: updated.stableKey, policyHostsAdded: hosts, cursorReset: process.env.LANGUAGE_REACTOR_PODCAST_RESET_CURSOR === "true" };
  } finally {
    await connection.client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  updateLanguageReactorPodcastAudioHosts()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "LANGUAGE_REACTOR_POLICY_UPDATE_FAILED"}\n`); process.exitCode = 1; });
}
