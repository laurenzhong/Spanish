"use client";

import { useEffect, useState } from "react";
import { CONVERSATION_LIST_UPDATED_EVENT } from "./conversation-contact-rail";

let cachedUnreadCount = 0;
let unreadRequest: Promise<void> | null = null;

function loadUnreadCount(): Promise<void> {
  if (unreadRequest) return unreadRequest;
  unreadRequest = fetch("/api/v1/conversations", { cache: "no-store" })
    .then((response) => response.ok ? response.json() as Promise<{ data?: { conversations?: Array<{ unreadCount?: number }> } }> : Promise.reject(new Error("CONVERSATIONS_UNAVAILABLE")))
    .then((payload) => {
      cachedUnreadCount = (payload.data?.conversations ?? []).reduce((total, conversation) => total + Math.max(0, conversation.unreadCount ?? 0), 0);
    })
    .catch(() => undefined)
    .finally(() => { unreadRequest = null; });
  return unreadRequest;
}

export function ConversationUnreadBadge() {
  const [count, setCount] = useState(cachedUnreadCount);

  useEffect(() => {
    let active = true;
    void loadUnreadCount().then(() => { if (active) setCount(cachedUnreadCount); });
    const refresh = () => void loadUnreadCount().then(() => { if (active) setCount(cachedUnreadCount); });
    window.addEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh);
    return () => { active = false; window.removeEventListener(CONVERSATION_LIST_UPDATED_EVENT, refresh); };
  }, []);

  if (count < 1) return null;
  return <span className="navigation-unread-count" aria-label={`${count} 条未读消息`}>{count > 99 ? "99+" : count}</span>;
}
