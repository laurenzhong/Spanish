import type { ContentPackProjection } from "../domain/content-pack";

export type ContentPackRepository = Readonly<{
  getByStableKey(stableKey: string, version?: number): Promise<ContentPackProjection | null>;
}>;
