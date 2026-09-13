import type { ContentAcquisitionRepository, ContentSourceRecord } from "../repositories";
import { registerContentSourceSchema, type RegisterContentSourceInput } from "../schemas";

export function registerContentSource(
  repository: ContentAcquisitionRepository,
  input: RegisterContentSourceInput,
): Promise<ContentSourceRecord> {
  return repository.registerSource(registerContentSourceSchema.parse(input));
}
