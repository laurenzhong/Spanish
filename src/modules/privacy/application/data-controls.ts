import type { PrivacyRepository } from "../repositories";

export function listSavedAudio(repository: PrivacyRepository, userId: string) {
  return repository.listSavedAudio(userId);
}

export function listSavedTranscripts(repository: PrivacyRepository, userId: string) {
  return repository.listTranscripts(userId);
}

export function deleteSavedAudio(
  repository: PrivacyRepository,
  userId: string,
  audioAssetId: string,
) {
  return repository.deleteSavedAudio(userId, audioAssetId);
}

export function deleteSavedTranscript(
  repository: PrivacyRepository,
  userId: string,
  attemptId: string,
) {
  return repository.deleteTranscript(userId, attemptId);
}
