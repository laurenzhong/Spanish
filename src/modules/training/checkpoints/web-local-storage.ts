import type { TrainingCheckpointStore } from "./training-checkpoint";

export function trainingCheckpointStorageKey(userId: string): string {
  return `spanish.training.checkpoint.v1:${encodeURIComponent(userId)}`;
}

export class LocalStorageTrainingCheckpointStore
  implements TrainingCheckpointStore
{
  constructor(
    private readonly storage: Storage,
    private readonly key: string,
  ) {}

  async read(): Promise<string | null> {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  async write(serialized: string): Promise<void> {
    try {
      this.storage.setItem(this.key, serialized);
    } catch {
      // Storage can be unavailable in private browsing or restricted frames.
    }
  }

  async clear(): Promise<void> {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Clearing is best effort; a malformed value is ignored on next load.
    }
  }
}

class UnavailableTrainingCheckpointStore implements TrainingCheckpointStore {
  async read(): Promise<string | null> {
    return null;
  }

  async write(serialized: string): Promise<void> {
    void serialized;
  }

  async clear(): Promise<void> {}
}

export function createBrowserTrainingCheckpointStore(
  userId: string,
): TrainingCheckpointStore {
  try {
    return new LocalStorageTrainingCheckpointStore(
      window.localStorage,
      trainingCheckpointStorageKey(userId),
    );
  } catch {
    return new UnavailableTrainingCheckpointStore();
  }
}
