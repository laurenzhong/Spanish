import type { MediaCard } from "./media";

type BrowseQuery = Readonly<{
  filters: Readonly<Record<string, unknown>>;
  seed: string;
  exclude: readonly string[];
  pageSize: number;
  cursor?: string;
}>;

// Deterministic ordering only; this hash is not used for security or identity.
function hash(value: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index += 1) {
    first = Math.imul(first ^ value.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(index);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

/** Exhaust all groups in rounds, dropping only exhausted queues, never content. */
function rotateGroups<T>(groups: readonly (readonly T[])[]): T[] {
  let active = groups.filter((group) => group.length > 0).map((group) => ({ group, index: 0 }));
  const result: T[] = [];
  while (active.length > 0) {
    const next: typeof active = [];
    for (const queue of active) {
      result.push(queue.group[queue.index++]);
      if (queue.index < queue.group.length) next.push(queue);
    }
    active = next;
  }
  return result;
}

export function selectMediaBrowsePage(
  candidates: readonly MediaCard[],
  query: BrowseQuery,
  sourceIdentities: ReadonlyMap<string, string> = new Map(),
) {
  const excluded = new Set(query.exclude);
  const unique = new Map(candidates.map((item) => [item.stableKey, item]));
  const eligible = [...unique.values()].filter((item) => !excluded.has(item.stableKey));
  // Source identifiers are repository-owned provenance, never display names.
  // Missing provenance must not invent a relationship between unrelated items.
  const sourceOf = (item: MediaCard) => `${item.kind}:${sourceIdentities.get(item.stableKey)?.trim() || `media:${item.stableKey}`}`;
  const groups = new Map<string, Map<string, MediaCard[]>>();
  for (const item of eligible) {
    const source = sourceOf(item);
    const series = item.series ? `series:${item.series.seriesKey}` : `media:${item.stableKey}`;
    const sourceGroups = groups.get(source) ?? new Map<string, MediaCard[]>();
    const group = sourceGroups.get(series) ?? [];
    group.push(item);
    sourceGroups.set(series, group);
    groups.set(source, sourceGroups);
  }
  const compare = (left: string, right: string) => {
    const a = hash(`${query.seed}:${left}`);
    const b = hash(`${query.seed}:${right}`);
    return a.localeCompare(b) || left.localeCompare(right);
  };
  const sources = [...groups.keys()].sort(compare);
  const sourceQueues = sources.map((source) => {
    const seriesGroups = groups.get(source)!;
    const series = [...seriesGroups.keys()].sort(compare);
    return rotateGroups(series.map((key) => seriesGroups.get(key)!.sort((left, right) => compare(left.stableKey, right.stableKey))));
  });
  const ordered = rotateGroups(sourceQueues);
  // Reject catalogue mutations during pagination, including a removed anchor.
  // No process-local snapshot or cached user progress is needed to resume.
  const context = hash(JSON.stringify([
    query.seed, Object.entries(query.filters).sort(([a], [b]) => a.localeCompare(b)),
    [...excluded].sort(), query.pageSize, ordered.map((item) => item.id),
    // A correction can leave the apparent order unchanged. Bind provenance and
    // catalogue revisions explicitly, including entries currently excluded.
    [...unique.values()].sort((left, right) => left.stableKey.localeCompare(right.stableKey))
      .map((item) => [item.id, sourceOf(item), item.series?.seriesKey ?? null, item.series?.revision ?? null]),
  ]));
  let offset = 0;
  if (query.cursor) {
    try {
      const cursor = JSON.parse(query.cursor) as { context?: unknown; after?: unknown };
      const index = ordered.findIndex((item) => item.stableKey === cursor.after);
      if (cursor.context !== context || index < 0) throw new Error();
      offset = index + 1;
    } catch { throw new Error("MEDIA_CURSOR_INVALID"); }
  }
  const items = ordered.slice(offset, offset + query.pageSize);
  const hasMore = offset + items.length < ordered.length;
  return {
    items, hasMore,
    nextCursor: hasMore ? JSON.stringify({ context, after: items.at(-1)!.stableKey }) : null,
  };
}
