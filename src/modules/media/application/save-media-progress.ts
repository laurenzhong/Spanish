import type { MediaRepository } from "../repositories";
import { mediaStableKeySchema, saveMediaProgressSchema } from "../schemas";

export function saveMediaProgress(
  repository: MediaRepository,
  userId: string,
  stableKey: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = saveMediaProgressSchema.parse(input);
  return repository.saveProgress(
    userId,
    mediaStableKeySchema.parse(stableKey),
    parsed.version,
    parsed,
    now,
  );
}
