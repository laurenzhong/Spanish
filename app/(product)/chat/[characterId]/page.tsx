import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
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
 * The page used to resolve the character runtime and the conversation history
 * before it rendered anything, so every contact switch paid that read wave
 * (`CONV-HISTORY-002`/`-003` measured 0.2-6 s for the remote round trips) while
 * `loading.tsx` covered the whole workspace. The conversation is now rendered
 * by the client thread instead:
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
      <div className="page-stack conversation-page conversation-page--detail">
        <div className="conversation-workspace">
          <ConversationContactRail />
          <section className="conversation-empty-state" aria-labelledby="conversation-coming-soon-title">
            <h1 id="conversation-coming-soon-title">角色尚未开放</h1>
            <p>{character.displayName} 的人物包和发布审核还在准备中。当前只能查看已发布角色。</p>
          </section>
        </div>
      </div>
    );
  }
  const paramsValue = await searchParams;
  const messageId = typeof paramsValue.message === "string" ? paramsValue.message : undefined;
  return (
    <div className="page-stack conversation-page conversation-page--detail">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey={character.key} />
        <ChatThread
          key={character.key}
          characterKey={character.key}
          characterName={character.displayName}
          roleLabel={character.roleLabel}
          characterVersion={character.version}
          avatarClassName={character.avatarClass}
          initialMessageId={messageId}
        />
      </div>
    </div>
  );
}
