import type { ContentPackProjection } from "./content-pack";

export type ContentPackProgress = Readonly<{
  packId: string;
  completedActivityIds: readonly string[];
  currentActivityId: string | null;
  draftReply: string;
}>;

export function createContentPackProgress(pack: ContentPackProjection): ContentPackProgress {
  return { packId: pack.id, completedActivityIds: [], currentActivityId: pack.activities[0]?.id ?? null, draftReply: "" };
}

export function parseContentPackProgress(pack: ContentPackProjection, value: unknown): ContentPackProgress {
  if (!value || typeof value !== "object") return createContentPackProgress(pack);
  const candidate = value as Record<string, unknown>;
  const activityIds = new Set(pack.activities.map((activity) => activity.id));
  const completed = Array.isArray(candidate.completedActivityIds)
    ? candidate.completedActivityIds.filter((id): id is string => typeof id === "string" && activityIds.has(id))
    : [];
  const current = typeof candidate.currentActivityId === "string" && activityIds.has(candidate.currentActivityId)
    ? candidate.currentActivityId
    : pack.activities.find((activity) => !completed.includes(activity.id))?.id ?? null;

  return {
    packId: pack.id,
    completedActivityIds: [...new Set(completed)],
    currentActivityId: current,
    draftReply: typeof candidate.draftReply === "string" ? candidate.draftReply.slice(0, 4_000) : "",
  };
}

export function completeContentPackActivity(progress: ContentPackProgress, pack: ContentPackProjection, activityId: string): ContentPackProgress {
  if (progress.packId !== pack.id || !pack.activities.some((activity) => activity.id === activityId)) return progress;
  const completed = new Set(progress.completedActivityIds);
  completed.add(activityId);
  return { ...progress, completedActivityIds: [...completed], currentActivityId: pack.activities.find((activity) => !completed.has(activity.id))?.id ?? null };
}

export function isContentPackComplete(progress: ContentPackProgress, pack: ContentPackProjection): boolean {
  return pack.activities.every((activity) => progress.completedActivityIds.includes(activity.id));
}
