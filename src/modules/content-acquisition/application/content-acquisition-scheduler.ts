import type { ContentSourceRecord } from "../repositories";

export type ContentPipelineSourcePlan = Readonly<{
  sourceStableKey: string;
  adapterType: ContentSourceRecord["adapterType"];
  limit: number;
}>;

export type ContentPipelineScheduleInput = Readonly<{
  sources: readonly ContentSourceRecord[];
  sourceStableKey?: string;
  limit: number;
  maxSources?: number;
}>;

export class ContentPipelineScheduleError extends Error {
  readonly code = "CONTENT_PIPELINE_SCHEDULE_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContentPipelineScheduleError";
  }
}

export function planContentPipelineSources(
  input: ContentPipelineScheduleInput,
): readonly ContentPipelineSourcePlan[] {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new ContentPipelineScheduleError("limit must be an integer between 1 and 500.");
  }
  const maxSources = input.maxSources ?? 50;
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 200) {
    throw new ContentPipelineScheduleError("maxSources must be an integer between 1 and 200.");
  }

  const byStableKey = new Map(input.sources.map((source) => [source.stableKey, source]));
  const selected = input.sourceStableKey
    ? (() => {
        const source = byStableKey.get(input.sourceStableKey!);
        if (!source) throw new ContentPipelineScheduleError("The requested source was not found.");
        return [source];
      })()
    : [...input.sources].sort((left, right) => left.stableKey.localeCompare(right.stableKey));

  const plans: ContentPipelineSourcePlan[] = [];
  for (const source of selected) {
    if (!source.enabled) {
      if (input.sourceStableKey) throw new ContentPipelineScheduleError("The requested source is disabled.");
      continue;
    }
    if (plans.length >= maxSources) break;
    plans.push({ sourceStableKey: source.stableKey, adapterType: source.adapterType, limit: input.limit });
  }
  if (plans.length === 0 && input.sourceStableKey === undefined) {
    throw new ContentPipelineScheduleError("No enabled content sources are configured.");
  }
  return plans;
}
