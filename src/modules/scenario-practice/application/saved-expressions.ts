import type { SavedExpressionSourceInput, ScenarioLibraryRepository } from "../repositories/scenario-library-repository";

export class SavedExpressionSourceError extends Error {
  constructor() { super("The saved-expression source is unavailable or not owned by the current user."); this.name = "SavedExpressionSourceError"; }
}

export class SavedExpressionConflictError extends Error {
  constructor() { super("The client save id was already used for different content."); this.name = "SavedExpressionConflictError"; }
}

export function listSavedExpressions(repository: ScenarioLibraryRepository, userId: string) {
  return repository.listSavedExpressions(userId);
}

export async function saveExpression(repository: ScenarioLibraryRepository, input: Readonly<{ userId: string; clientSaveId: string; source: SavedExpressionSourceInput }>) {
  const resolved = await repository.resolveSavedExpressionSource(input.userId, input.source);
  if (!resolved) throw new SavedExpressionSourceError();
  const existing = await repository.findSavedExpressionByClientSaveId(input.userId, input.clientSaveId);
  if (existing) {
    if (existing.sourceText !== resolved.sourceText || existing.sourceType !== resolved.sourceType || existing.sourceEntityId !== resolved.sourceEntityId) throw new SavedExpressionConflictError();
    return existing;
  }
  return repository.createSavedExpression({ ...resolved, userId: input.userId, clientSaveId: input.clientSaveId });
}

export function deleteSavedExpression(repository: ScenarioLibraryRepository, userId: string, savedExpressionId: string) {
  return repository.archiveSavedExpression(userId, savedExpressionId);
}
