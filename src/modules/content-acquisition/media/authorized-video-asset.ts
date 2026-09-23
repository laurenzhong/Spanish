import { resolve, join } from "node:path";

export function resolveAuthorizedVideoAssetPath(directory: string | null | undefined, candidateId: string): string | null {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(candidateId)) {
    throw new Error("CONTENT_CANDIDATE_ID_INVALID");
  }
  const root = directory?.trim();
  return root ? join(resolve(root), `${candidateId}.mp4`) : null;
}
