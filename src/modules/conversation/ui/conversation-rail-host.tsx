"use client";

import { useParams } from "next/navigation";

import { ConversationContactRail } from "./conversation-contact-rail";
import type { ConversationPreview } from "../application/list-previews";

type ConversationRailHostProps = Readonly<{
  initialConversations?: readonly ConversationPreview[];
}>;

/**
 * The chat layout owns the contact rail so a contact switch neither re-renders
 * nor re-reads it. A layout cannot read the child segment's params, so the
 * active contact is derived from the current URL here instead of being passed
 * down by every page; the server-rendered list arrives as `initialConversations`
 * and the rail keeps its own background refresh.
 */
export function ConversationRailHost({ initialConversations }: ConversationRailHostProps) {
  const params = useParams();
  const segment = (params as Record<string, string | string[] | undefined> | null)?.characterId;
  const activeCharacterKey = typeof segment === "string" && segment.length > 0 ? segment : undefined;

  return (
    <ConversationContactRail
      activeCharacterKey={activeCharacterKey}
      initialConversations={initialConversations}
    />
  );
}
