import type {
  AccountBusinessDataDeletionResult,
  AccountDataSummary,
  PrivacyRepository,
} from "../repositories";
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

type DeletionOptions = Readonly<{
  diagnostics?: DiagnosticEventWriter;
  requestId?: string;
}>;

async function runStorageCleanup(
  repository: PrivacyRepository,
  storageDeleter: StorageObjectDeleter,
  deletion: AccountBusinessDataDeletionResult,
  userId: string,
  options: DeletionOptions,
): Promise<number> {
  if (deletion.cleanupTasks.length === 0) return 0;
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
  return storageResult.deferred ? deletion.cleanupTasks.length : 0;
}

export async function deleteAccountData(
  repository: PrivacyRepository,
  storageDeleter: StorageObjectDeleter,
  userId: string,
  options: DeletionOptions = {},
): Promise<DeleteAccountDataResult> {
  const deletion = await repository.transaction((transaction) =>
    transaction.deleteAccountData(userId),
  );
  const cleanupDeferred = await runStorageCleanup(
    repository,
    storageDeleter,
    deletion,
    userId,
    options,
  );
  return {
    alreadyDeleted: deletion.alreadyDeleted,
    cleanupDeferred,
    evidenceDeleted: deletion.evidenceDeleted,
    providerCallsAnonymized: deletion.providerCallsAnonymized,
  };
}

/**
 * Account-deletion phase 1 (ACCT-ADMIN-001): clear business data and register
 * Storage cleanup tasks, but keep the `profiles` tombstone row so a later Auth
 * user removal or an interrupted deletion can still be resolved and retried.
 */
export async function clearAccountBusinessData(
  repository: PrivacyRepository,
  storageDeleter: StorageObjectDeleter,
  userId: string,
  options: DeletionOptions = {},
): Promise<DeleteAccountDataResult> {
  const deletion = await repository.transaction((transaction) =>
    transaction.clearAccountBusinessData(userId),
  );
  const cleanupDeferred = await runStorageCleanup(
    repository,
    storageDeleter,
    deletion,
    userId,
    options,
  );
  return {
    alreadyDeleted: deletion.alreadyDeleted,
    cleanupDeferred,
    evidenceDeleted: deletion.evidenceDeleted,
    providerCallsAnonymized: deletion.providerCallsAnonymized,
  };
}

/**
 * Account-deletion phase 2: remove the profile tombstone after the Supabase Auth
 * user has been deleted. Cascades the remaining private rows. Returns whether the
 * profile row was still present.
 */
export function removeAccountProfile(
  repository: PrivacyRepository,
  userId: string,
): Promise<boolean> {
  return repository.deleteAccountProfile(userId);
}
