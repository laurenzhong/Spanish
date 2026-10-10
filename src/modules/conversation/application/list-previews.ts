import { findConversationCharacter } from "../domain/character-catalog";
import type { ConversationListRecord } from "../repositories/conversation-repository";

export type ConversationPreview = Readonly<{
  conversationId: string;
  characterKey: string;
  characterName: string;
  avatarUrl: string | null;
  avatarClass: string;
  roleLabel: string;
  lastMessageAt: string | null;
  lastMessage: { role: "user" | "character"; snippet: string; createdAt: string } | null;
  isPinned: boolean;
  isMuted: boolean;
  sortRank: number | null;
  unreadCount?: number;
}>;

export function toConversationPreview(record: ConversationListRecord): ConversationPreview {
  const character = findConversationCharacter(record.characterKey);
  return {
    conversationId: record.conversationId,
    characterKey: record.characterKey,
    characterName: record.characterName,
    avatarUrl: record.avatarUrl,
    avatarClass: character?.avatarClass ?? "avatar--lucia",
    roleLabel: character?.roleLabel ?? "角色",
    lastMessageAt: record.lastMessageAt?.toISOString() ?? null,
    isPinned: record.isPinned,
    isMuted: record.isMuted,
    sortRank: record.sortRank,
    unreadCount: record.unreadCount ?? 0,
    lastMessage: record.lastMessage
      ? { role: record.lastMessage.role, snippet: record.lastMessage.content.slice(0, 160), createdAt: record.lastMessage.createdAt.toISOString() }
      : null,
  };
}

export function toConversationPreviews(records: readonly ConversationListRecord[]): readonly ConversationPreview[] {
  return records.map(toConversationPreview);
}
