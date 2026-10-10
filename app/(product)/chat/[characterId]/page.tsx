import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import {
  findConversationCharacter,
  isConversationCharacterDiscoverable,
} from "@/src/modules/conversation";

type CharacterPageProps = Readonly<{
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
}>;

export async function generateMetadata({ params }: CharacterPageProps): Promise<Metadata> {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  return { title: character ? `${character.displayName} 对话` : "对话" };
}

/**
 * Choosing a contact must never wait for the database.
 *
 * The page renders the pane only - the contact rail belongs to the chat layout,
 * which is reused while the user switches contacts - and it renders it without
 * any database or auth read:
 *
 * - `ChatThread` paints the cached snapshot of the conversation immediately
 *   (the contact rail prefetches it on hover/focus) and revalidates in the
 *   background through `/api/v1/conversations/{key}`, keeping its own loading,
 *   retry and unavailable states;
 * - the composer stays unavailable until a server read succeeds, so an
 *   unpublished or unreachable character can never look sendable;
 * - the history route and the stream route still re-check the published
 *   character, the contact gate and the send permission on the server. Client
 *   state is a view, never a capability.
 *
 * The one gate kept here is the checked-in runtime manifest, which is static:
 * draft characters render "角色尚未开放" synchronously, without a read.
 */
export default async function CharacterChatPage({ params, searchParams }: CharacterPageProps) {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  if (!character) notFound();
  if (!isConversationCharacterDiscoverable(character.key, character.version)) {
    return (
      <section className="conversation-empty-state" aria-labelledby="conversation-coming-soon-title">
        <h1 id="conversation-coming-soon-title">角色尚未开放</h1>
        <p>{character.displayName} 的人物包和发布审核还在准备中。当前只能查看已发布角色。</p>
      </section>
    );
  }
  const paramsValue = await searchParams;
  const messageId = typeof paramsValue.message === "string" ? paramsValue.message : undefined;
  return (
    <ChatThread
      key={character.key}
      characterKey={character.key}
      characterName={character.displayName}
      roleLabel={character.roleLabel}
      characterVersion={character.version}
      avatarClassName={character.avatarClass}
      initialMessageId={messageId}
    />
  );
}
