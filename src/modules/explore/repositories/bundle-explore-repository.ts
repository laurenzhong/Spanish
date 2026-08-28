import bundle from "@/content/bundles/alpha-core-v1.json";

import { projectContentPack } from "@/src/modules/content/domain";
import { validateContentBundle } from "@/src/modules/content/import";
import type { ContentBundle } from "@/src/modules/content/schemas";
import type { ExploreContentPackRecord, ExploreGoalRecord, ExploreRepository } from "../domain";

const validatedBundle = validateContentBundle(bundle) as ContentBundle;

function skillsFor(pack: ContentBundle["contentPacks"][number]): ExploreContentPackRecord["skills"] {
  const skills = new Set<ExploreContentPackRecord["skills"][number]>();
  for (const activity of pack.activities) {
    if (activity.modality === "listening") skills.add("listen");
    if (activity.modality === "reading") skills.add("read");
    if (activity.modality === "speech") skills.add("speak");
    if (activity.modality === "typing") skills.add("write");
  }
  return [...skills];
}

export class BundleExploreRepository implements ExploreRepository {
  constructor(private readonly source: ContentBundle = validatedBundle) {}

  async listGoals(): Promise<readonly ExploreGoalRecord[]> {
    const expressionCounts = new Map<string, number>();
    for (const expression of this.source.expressions) {
      expressionCounts.set(expression.goalKey, (expressionCounts.get(expression.goalKey) ?? 0) + 1);
    }
    return this.source.goals.map((goal) => ({
      stableKey: goal.stableKey,
      title: goal.title,
      description: goal.description,
      position: goal.position,
      status: goal.status,
      expressionCount: expressionCounts.get(goal.stableKey) ?? 0,
    }));
  }

  async listContentPacks(): Promise<readonly ExploreContentPackRecord[]> {
    return this.source.contentPacks.map((rawPack) => {
      const pack = projectContentPack(rawPack);
      const source = rawPack.sources[0];
      return {
        id: pack.id,
        stableKey: pack.stableKey,
        version: pack.version,
        title: pack.title,
        summary: pack.summary,
        cefr: pack.cefr,
        sourceTitle: source?.title ?? null,
        copyrightStatus: source?.copyrightStatus ?? "unverified",
        status: pack.status,
        skills: skillsFor(rawPack),
        activityCount: pack.activities.length,
        updatedAt: rawPack.publishedAt ?? null,
      };
    });
  }
}
