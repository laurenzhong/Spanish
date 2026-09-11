import { getScenarioPracticeDetail } from "../content";
import type { ScenarioLibraryRepository } from "../repositories";

export function getPublicScenarioDetail(stableKey: string) {
  return getScenarioPracticeDetail(stableKey);
}

export async function getScenarioPracticeDetailForUser(repository: ScenarioLibraryRepository | null, stableKey: string, userId: string) {
  const publicDetail = getScenarioPracticeDetail(stableKey);
  if (publicDetail) return publicDetail;
  const match = /^personal\.([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/iu.exec(stableKey);
  if (!match || !repository) return null;
  return (await repository.getPersonalScenario(userId, match[1]!))?.detail ?? null;
}
