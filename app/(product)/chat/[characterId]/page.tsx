import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";

type CharacterPageProps = Readonly<{
  params: Promise<{ characterId: string }>;
}>;

export const metadata: Metadata = { title: "Lucía 对话" };

export default async function CharacterChatPage({ params }: CharacterPageProps) {
  const { characterId } = await params;
  if (characterId !== "lucia") notFound();

  return (
    <div className="page-stack conversation-page conversation-page--detail">
      <div className="conversation-workspace">
        <ConversationContactRail activeCharacterKey="lucia" />
        <ChatThread characterKey="lucia" characterName="Lucía Martín" characterVersion={1} />
      </div>
    </div>
  );
}
