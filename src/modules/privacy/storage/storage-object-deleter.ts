import { createClient } from "@supabase/supabase-js";

import type { StorageCleanupTask } from "../repositories";

export type StorageDeletionResult = Readonly<{
  deferred: boolean;
  errorMessage?: string;
}>;

export interface StorageObjectDeleter {
  delete(tasks: readonly StorageCleanupTask[]): Promise<StorageDeletionResult>;
}

export function createSupabaseStorageObjectDeleter(): StorageObjectDeleter {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    return {
      async delete() {
        return {
          deferred: true,
          errorMessage: "Storage cleanup is not configured.",
        };
      },
    };
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async delete(tasks) {
      const byBucket = new Map<string, string[]>();
      for (const task of tasks) {
        const paths = byBucket.get(task.storageBucket) ?? [];
        paths.push(task.storagePath);
        byBucket.set(task.storageBucket, paths);
      }

      for (const [bucket, paths] of byBucket) {
        const { error } = await client.storage.from(bucket).remove(paths);
        if (error) {
          return { deferred: true, errorMessage: "Storage cleanup failed." };
        }
      }

      return { deferred: false };
    },
  };
}
