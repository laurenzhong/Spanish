import type { getDatabase } from "@/src/shared/db/client";

import type { ConversationPreview } from "./list-previews";
import { toConversationPreviews } from "./list-previews";
import { isConversationCharacterDiscoverable } from "../domain/character-catalog";
import { createDrizzleConversationRepository } from "../repositories";

/**
 * The contact list is the same read for the server-rendered first paint of the
 * conversation workspace and for `GET /api/v1/conversations`, so the capability
 * manifest recheck lives here instead of in one of the two transports. Rows are
 * rechecked at this boundary because client-visible contact discovery must
 * never trust a stale or static draft row.
 */
export async function listConversationPreviews(
  database: ReturnType<typeof getDatabase>,
  userId: string,
): Promise<readonly ConversationPreview[]> {
  const records = await createDrizzleConversationRepository(database).listConversations(userId);
  return toConversationPreviews(
    records.filter((record) => isConversationCharacterDiscoverable(record.characterKey)),
  );
}
