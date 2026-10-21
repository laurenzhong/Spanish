import { z } from "zod";
import { ContentSourceAdapterError } from "../content-source-adapter";

export const youtubeAllowedVideoIdsSchema = z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/u)).min(1).max(2)
  // Existing media stable keys are lowercase; do not introduce a collision within this scope.
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length);

const cursorSchema = z.strictObject({
  mode: z.literal("exact-video-ids"),
  version: z.literal(1),
  sourceStableKey: z.string().min(1),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/u),
  videoIds: youtubeAllowedVideoIdsSchema,
  offset: z.number().int().nonnegative(),
});

export function getExactYouTubeDiscoveryPage(input: Readonly<{
  allowedVideoIds: unknown;
  channelId: string;
  sourceStableKey: string;
  cursor: string | null;
  limit: number;
}>): Readonly<{ videoIds: readonly string[]; nextCursor: string | null }> {
  const parsedIds = youtubeAllowedVideoIdsSchema.safeParse(input.allowedVideoIds);
  if (!parsedIds.success || !/^UC[A-Za-z0-9_-]{22}$/u.test(input.channelId)) {
    throw new ContentSourceAdapterError("YouTube exact-video configuration is invalid.", false);
  }
  const videoIds = parsedIds.data;
  let offset = 0;
  if (input.cursor !== null) {
    try {
      const cursor = cursorSchema.parse(JSON.parse(input.cursor));
      if (cursor.channelId !== input.channelId || cursor.sourceStableKey !== input.sourceStableKey || JSON.stringify(cursor.videoIds) !== JSON.stringify(videoIds) || cursor.offset >= videoIds.length) throw new Error();
      offset = cursor.offset;
    } catch {
      throw new ContentSourceAdapterError("YouTube exact-video cursor is invalid or its configuration changed; reset the source cursor before retrying.", false);
    }
  }
  const selected = videoIds.slice(offset, offset + input.limit);
  const nextOffset = offset + selected.length;
  return {
    videoIds: selected,
    // A completed bounded pass resets so a later run can recheck the same IDs.
    nextCursor: nextOffset < videoIds.length ? JSON.stringify({ mode: "exact-video-ids", version: 1, sourceStableKey: input.sourceStableKey, channelId: input.channelId, videoIds, offset: nextOffset }) : null,
  };
}
