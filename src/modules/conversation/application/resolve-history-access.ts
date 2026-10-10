import {
  createDrizzleIntroductionRepository,
  createDrizzleLuciaContactRepository,
} from "@/src/modules/character-network";
import type { getDatabase } from "@/src/shared/db/client";

export type ConversationContactStatus = "pending" | "active" | "declined" | "unavailable";

export type ConversationHistoryAccess = Readonly<{
  readOnly: boolean;
  canSend: boolean;
  contactStatus: ConversationContactStatus;
}>;

/**
 * A history read must remain useful when the contact gate is not currently
 * readable, but it must never turn that uncertainty into send permission.
 * The stream route re-checks the same relationship before writing anything.
 *
 * Both the history route and the chat page need this decision, so it lives
 * here rather than in one of the two transports.
 */
export async function resolveHistoryAccess(
  database: ReturnType<typeof getDatabase>,
  userId: string,
  characterKey: string,
): Promise<ConversationHistoryAccess> {
  try {
    if (characterKey === "lucia") {
      const contact = await createDrizzleLuciaContactRepository(database).get(userId);
      return contact.status === "active"
        ? { readOnly: false, canSend: true, contactStatus: "active" }
        : { readOnly: true, canSend: false, contactStatus: contact.status };
    }

    const statusReader = createDrizzleIntroductionRepository(database).getRelationshipStatus;
    if (!statusReader) {
      return { readOnly: true, canSend: false, contactStatus: "unavailable" };
    }
    const status = await statusReader(userId, characterKey, 1);
    // A published character without a relationship is waiting for an
    // introduction/acceptance, rather than being a persistence failure.
    if (status === "active") return { readOnly: false, canSend: true, contactStatus: "active" };
    if (status === "declined") return { readOnly: true, canSend: false, contactStatus: "declined" };
    return { readOnly: true, canSend: false, contactStatus: "pending" };
  } catch {
    return { readOnly: true, canSend: false, contactStatus: "unavailable" };
  }
}
