import { savedReadingItemIdSchema } from "../domain/saved-items";
import type { ReadingRepository } from "../repositories/reading-repository";

/** Removes one user-owned reading annotation. This is not a learning-evidence mutation. */
export async function deleteSavedReadingItem(repository: ReadingRepository, userId: string, itemId: string) {
  return repository.deleteSavedItem(userId, savedReadingItemIdSchema.parse(itemId));
}
