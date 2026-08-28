import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import { findConversationCharacter } from "@/src/modules/conversation";

type CharacterPageProps = Readonly<{
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
}>;

export async function generateMetadata({ params }: CharacterPageProps): Promise<Metadata> {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  return { title: character ? `${character.displayName} 对话` : "对话" };
}

export default async function CharacterChatPage({ params, searchParams }: CharacterPageProps) {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  if (!character) notFound();
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
