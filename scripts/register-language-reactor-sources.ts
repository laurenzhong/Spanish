import "dotenv/config";

import { pathToFileURL } from "node:url";

import { createDrizzleContentAcquisitionRepository, registerContentSource } from "../src/modules/content-acquisition";
import { createDatabaseConnection } from "../src/shared/db/client";

const directoryBase = "https://www.languagereactor.com/c/es";
const authorizationNote = "Owner-provided authorization statement on 2026-09-15: Language Reactor platform and all included authors authorized complete use for this personal Alpha; no attribution requested.";

const defaultAudioHosts = [
  "traffic.libsyn.com",
  "content.libsyn.com",
  "traffic.megaphone.fm",
  "dcs-spotify.megaphone.fm",
  "ztnr.rtve.es",
  "rtve-mediavod-lote3.rtve.es",
];

function audioHosts(): string[] {
  const configured = process.env.LANGUAGE_REACTOR_AUDIO_HOSTS?.split(",").map((host) => host.trim()).filter(Boolean);
  return configured?.length ? configured : defaultAudioHosts;
}

function sourceInput(kind: "video-channel" | "podcast-feed") {
  const isPodcast = kind === "podcast-feed";
  const playlistId = isPodcast ? "t_pd_mix_es" : "t_yt_mix_es";
  return {
    id: isPodcast ? "c4c7af30-cfb4-4cc3-9f97-6a2fb7bfa3f0" : "2c776d83-8b8d-4a6c-a3bc-3b8b31d3a5ad",
    stableKey: isPodcast ? "language-reactor.podcast-mix-es" : "language-reactor.youtube-mix-es",
    adapterType: "language-reactor" as const,
    sourceKind: kind,
    externalSourceId: playlistId,
    displayName: isPodcast ? "Language Reactor Podcast Mix" : "Language Reactor YouTube Mix",
    language: "es",
    region: "es-ES",
    enabled: true,
    rightsStatus: "verified" as const,
    rightsPolicy: {
      provider: "language-reactor",
      directoryUrl: `${directoryBase}/${isPodcast ? "pd/t_pd_mix_es" : "yt/t_yt_mix_es"}`,
      apiHost: "api-cdn.dioco.io",
      license: "licensed",
      attribution: "No attribution required by the owner-provided authorization.",
      licenseEvidence: "https://www.languagereactor.com/c/es/pd/t_pd_mix_es",
      cefr: "A2",
      topics: ["topic.daily-life", "topic.media"],
      allowedAudioHosts: audioHosts(),
      allowedAudioMimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "application/ogg"],
      minDurationMs: 15_000,
      maxDurationMs: isPodcast ? 3_600_000 : 43_200_000,
      maxApiBytes: 5_000_000,
      maxEnclosureBytes: 1_000_000_000,
      playbackValidityHours: null,
      authorization: authorizationNote,
    },
    schedule: { mode: "manual", note: "Run explicitly until OPS-001 schedules this source." },
    rateLimit: { requestsPerMinute: 30 },
    cursor: null,
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  const connection = createDatabaseConnection(databaseUrl);
  try {
    const repository = createDrizzleContentAcquisitionRepository(connection.db);
    const podcast = await registerContentSource(repository, sourceInput("podcast-feed"));
    const youtube = await registerContentSource(repository, sourceInput("video-channel"));
    process.stdout.write(JSON.stringify({ podcast: podcast.stableKey, youtube: youtube.stableKey, enabled: true }) + "\n");
  } finally {
    await connection.client.end();
  }
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Failed to register sources."}\n`);
    process.exitCode = 1;
  });
}
