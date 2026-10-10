import { ConversationRailHost } from "@/src/modules/conversation/ui/conversation-rail-host";
import { listConversationPreviews, type ConversationPreview } from "@/src/modules/conversation";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

/**
 * Server-rendered first paint for the contact list.
 *
 * The list is read here, once per page load, instead of after hydration, so the
 * contacts are already on screen when the workspace appears and no extra client
 * round trip is needed. A failed or unavailable read is not a failed page: the
 * rail keeps its own request, retry and "暂时无法加载会话列表" path when no
 * server view is handed down.
 */
export async function loadContactRailConversations(): Promise<readonly ConversationPreview[] | undefined> {
  if (!process.env.DATABASE_URL) return undefined;
  try {
    const user = await getCurrentUser();
    if (!user) return undefined;
    return await listConversationPreviews(getDatabase(), user.id);
  } catch {
    return undefined;
  }
}

export default async function ContactRailWithFirstPaint() {
  return <ConversationRailHost initialConversations={await loadContactRailConversations()} />;
}
