import { isContentPackAvailable, type ContentPackProjection } from "../domain";
import type { ContentPackRepository } from "../repositories";

export type GetContentPackResult =
  | Readonly<{ status: "found"; pack: ContentPackProjection }>
  | Readonly<{ status: "not-found" | "unavailable" }>;

export async function getContentPack(repository: ContentPackRepository, stableKey: string, options: Readonly<{ allowDraft?: boolean; version?: number }> = {}): Promise<GetContentPackResult> {
  const pack = await repository.getByStableKey(stableKey, options.version);
  if (!pack) return { status: "not-found" };
  if (!isContentPackAvailable(pack, options.allowDraft ?? false)) return { status: "unavailable" };
  return { status: "found", pack };
}
