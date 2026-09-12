import bundle from "@/content/bundles/alpha-core-v2.json";

import { validateContentBundle } from "../import";
import type { ContentBundle } from "../schemas";
import { projectContentPack, type ContentPackProjection } from "../domain/content-pack";
import type { ContentPackRepository } from "./content-pack-repository";

const validatedBundle = validateContentBundle(bundle) as ContentBundle;

export class BundleContentPackRepository implements ContentPackRepository {
  constructor(private readonly source: ContentBundle = validatedBundle) {}

  async getByStableKey(stableKey: string, version = 1): Promise<ContentPackProjection | null> {
    const pack = this.source.contentPacks.find((candidate) => candidate.stableKey === stableKey && candidate.version === version);
    return pack ? projectContentPack(pack) : null;
  }
}
