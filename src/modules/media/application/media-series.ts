import { z } from "zod";

import { assertContentWorkflowOwner } from "@/src/shared/auth/content-workflow-owner";

import { MediaSeriesError, validateMediaSeriesCommand } from "../domain/media-series";
import type { MediaSeriesRepository } from "../repositories/media-series-repository";
import { mediaSeriesEpisodesQuerySchema, mediaSeriesKeySchema, saveMediaSeriesCommandSchema } from "../schemas/media-series";

const authenticatedUserIdSchema = z.uuid();

/** userId must come from the authenticated server session, independently of request data. */
function parseReadIdentity(key: string, userId: string): Readonly<{ key: string; userId: string }> {
  const parsedKey = mediaSeriesKeySchema.safeParse(key);
  const parsedUserId = authenticatedUserIdSchema.safeParse(userId);
  if (!parsedKey.success || !parsedUserId.success) throw new MediaSeriesError("MEDIA_SERIES_QUERY_INVALID");
  return { key: parsedKey.data, userId: parsedUserId.data };
}

export async function getMediaSeries(repository: MediaSeriesRepository, seriesKey: string, userId: string) {
  const identity = parseReadIdentity(seriesKey, userId);
  return repository.getSeries(identity.key, identity.userId);
}

export async function listMediaSeriesEpisodes(repository: MediaSeriesRepository, seriesKey: string, query: unknown, userId: string) {
  const identity = parseReadIdentity(seriesKey, userId);
  const parsedQuery = mediaSeriesEpisodesQuerySchema.safeParse(query);
  if (!parsedQuery.success) throw new MediaSeriesError("MEDIA_SERIES_QUERY_INVALID");
  return repository.listEpisodes(identity.key, parsedQuery.data, identity.userId);
}

export async function getMediaSeriesRecommendations(repository: MediaSeriesRepository, stableKey: string, userId: string) {
  const identity = parseReadIdentity(stableKey, userId);
  return repository.recommendations(identity.key, identity.userId);
}

export async function saveMediaSeries(repository: MediaSeriesRepository, seriesKey: string, command: unknown, ownerUserId: string) {
  // Fail closed before looking at the requested resource or allowing storage side effects.
  ownerUserId = ownerUserId.toLowerCase();
  assertContentWorkflowOwner(ownerUserId);
  const parsedKey = mediaSeriesKeySchema.safeParse(seriesKey);
  const parsedCommand = saveMediaSeriesCommandSchema.safeParse(command);
  if (!parsedKey.success || !parsedCommand.success) throw new MediaSeriesError("MEDIA_SERIES_COMMAND_INVALID");
  validateMediaSeriesCommand(parsedCommand.data);
  return repository.save(parsedKey.data, parsedCommand.data, authenticatedUserIdSchema.parse(ownerUserId));
}
