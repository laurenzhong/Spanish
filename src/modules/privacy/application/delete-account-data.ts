import type { AccountDataSummary, PrivacyRepository } from "../repositories";
import type { StorageObjectDeleter } from "../storage/storage-object-deleter";
import { recordDiagnosticEventSafely, type DiagnosticEventWriter } from "@/src/shared/observability";

export const ACCOUNT_DATA_CONFIRMATION = "DELETE_MY_DATA" as const;

export function getAccountDataSummary(
  repository: PrivacyRepository,
  userId: string,
): Promise<AccountDataSummary> {
  return repository.getAccountDataSummary(userId);
}

export type DeleteAccountDataResult = Readonly<{
  alreadyDeleted: boolean;
  cleanupDeferred: number;
  evidenceDeleted: number;
  providerCallsAnonymized: number;
}>;

export async function deleteAccountData(
  repository: PrivacyRepository,
  storageDeleter: StorageObjectDeleter,
  userId: string,
  options: Readonly<{ diagnostics?: DiagnosticEventWriter; requestId?: string }> = {},
): Promise<DeleteAccountDataResult> {
  const deletion = await repository.transaction((transaction) =>
    transaction.deleteAccountData(userId),
  );

  let cleanupDeferred = 0;
  if (deletion.cleanupTasks.length > 0) {
    const storageResult = await storageDeleter.delete(deletion.cleanupTasks);
    for (const task of deletion.cleanupTasks) {
      await repository.updateStorageCleanupTask(
        task.id,
        storageResult.deferred ? "failed" : "completed",
        storageResult.errorMessage,
      );
      if (storageResult.deferred) {
        await recordDiagnosticEventSafely(options.diagnostics, {
          userId,
          eventType: "privacy.storage_cleanup_failed",
          severity: "alert",
          dedupeKey: `storage-cleanup-failed:${task.id}`,
          correlation: { requestId: options.requestId },
          errorType: "storage-cleanup-failed",
          metadata: { taskId: task.id },
        });
      }
    }
    cleanupDeferred = storageResult.deferred ? deletion.cleanupTasks.length : 0;
  }

  return {
    alreadyDeleted: deletion.alreadyDeleted,
    cleanupDeferred,
    evidenceDeleted: deletion.evidenceDeleted,
    providerCallsAnonymized: deletion.providerCallsAnonymized,
  };
}
