import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ChatThread } from "@/src/modules/conversation/ui/chat-thread";
import { ConversationContactRail } from "@/src/modules/conversation/ui/conversation-contact-rail";
import {
  CharacterRuntimeError,
  createDrizzleConversationRepository,
  findConversationCharacter,
  isConversationCharacterDiscoverable,
  isConversationStaticFallbackAllowed,
  listConversationHistory,
  resolveConversationCharacter,
  resolveHistoryAccess,
  type ConversationHistoryAccess,
  type ConversationMessage,
} from "@/src/modules/conversation";
import { createDrizzleCharacterRepository } from "@/src/modules/characters";
import { getCurrentUser } from "@/src/shared/auth/server";
import { getDatabase } from "@/src/shared/db/client";

type CharacterPageProps = Readonly<{
  params: Promise<{ characterId: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
}>;

export async function generateMetadata({ params }: CharacterPageProps): Promise<Metadata> {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  return { title: character ? `${character.displayName} 对话` : "对话" };
}

type PageCharacterState = Readonly<{
  status: "available" | "coming-soon" | "unavailable";
  characterName?: string;
}>;

async function resolvePageCharacterState(
  characterKey: string,
  fallbackName: string,
): Promise<PageCharacterState> {
  // A static catalog is a deterministic fixture only. In production the
  // characters table is authoritative, so a missing/unreachable database
  // must not render a composer that will inevitably fail on submit.
  if (!process.env.DATABASE_URL) {
    if (!isConversationStaticFallbackAllowed()) return { status: "unavailable" };
    return isConversationCharacterDiscoverable(characterKey, 1)
      ? { status: "available", characterName: fallbackName }
      : { status: "coming-soon", characterName: fallbackName };
  }

  try {
    const database = getDatabase();
    const resolved = await resolveConversationCharacter({
      characterKey,
      characterVersion: 1,
      repository: process.env.NODE_ENV === "test" ? undefined : createDrizzleCharacterRepository(database),
      allowStaticFallback: isConversationStaticFallbackAllowed(),
    });
    return { status: "available", characterName: resolved.catalog.displayName };
  } catch (error) {
    const errorCode = error instanceof CharacterRuntimeError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (errorCode === "CHARACTER_UNAVAILABLE") {
      return { status: "coming-soon", characterName: fallbackName };
    }
    if (errorCode === "CHARACTER_RUNTIME_UNAVAILABLE") {
      return { status: "unavailable", characterName: fallbackName };
    }
    return { status: "unavailable", characterName: fallbackName };
  }
}

type PageHistory = Readonly<{
  messages: readonly ConversationMessage[];
  access: ConversationHistoryAccess;
}>;

/**
 * The server renders the conversation itself so the first paint already carries
 * real messages. Previously the thread fetched them after hydration, which
 * showed a loading skeleton for a whole round trip and rendered "cannot open
 * this conversation" whenever that read was slow or failed.
 *
 * Returning null is not a failure state: without a server view the client
 * falls back to its own history request and its own retry path, exactly as
 * before.
 */
async function loadPageHistory(characterKey: string): Promise<PageHistory | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    const database = getDatabase();
    const [messages, access] = await Promise.all([
      listConversationHistory(createDrizzleConversationRepository(database), user.id, characterKey),
      resolveHistoryAccess(database, user.id, characterKey),
    ]);
    return { messages, access };
  } catch {
    return null;
  }
}

export default async function CharacterChatPage({ params, searchParams }: CharacterPageProps) {
  const { characterId } = await params;
  const character = findConversationCharacter(characterId);
  if (!character) notFound();
  // One wave: the character gate and the history read are independent, and the
  // client no longer has to wait for a second round trip to show the thread.
  const [pageState, history] = await Promise.all([
    resolvePageCharacterState(character.key, character.displayName),
    loadPageHistory(character.key),
  ]);
  if (pageState.status === "coming-soon") {
    return (
      <div className="page-stack conversation-page conversation-page--detail">
        <div className="conversation-workspace">
          <ConversationContactRail />
          <section className="conversation-empty-state" aria-labelledby="conversation-coming-soon-title">
            <h1 id="conversation-coming-soon-title">角色尚未开放</h1>
            <p>{pageState.characterName ?? character.displayName} 的人物包和发布审核还在准备中。当前只能查看已发布角色。</p>
          </section>
        </div>
      </div>
    );
  }
  if (pageState.status === "unavailable") {
    return (
      <div className="page-stack conversation-page conversation-page--detail">
        <div className="conversation-workspace">
          <ConversationContactRail />
          <section className="conversation-empty-state" aria-labelledby="conversation-unavailable-title">
            <h1 id="conversation-unavailable-title">对话暂时不可用</h1>
            <p>角色运行时或保存服务暂时不可用，请稍后重试。</p>
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
          characterName={pageState.characterName ?? character.displayName}
          roleLabel={character.roleLabel}
          characterVersion={character.version}
          avatarClassName={character.avatarClass}
          initialMessageId={messageId}
          initialMessages={history?.messages}
          initialAccess={history?.access}
        />
      </div>
    </div>
  );
}
