"use client";

import Link from "next/link";
import { conversationCharacters } from "../domain/character-catalog";
import { ConversationSearch } from "./conversation-search";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: string;
}>;

export function ConversationContactRail({ activeCharacterKey }: ConversationContactRailProps) {
  return (
    <aside className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <div>
          <p className="eyebrow eyebrow--accent">私信</p>
          <h2>对话</h2>
        </div>
        <span className="conversation-contact-rail__count">{conversationCharacters.length} 位角色</span>
      </div>

      <ConversationSearch />

      <p className="conversation-contact-rail__label">最近</p>
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        {conversationCharacters.map((character, index) => (
          <Link
            className={`conversation-contact-row ${activeCharacterKey === character.key ? "conversation-contact-row--active" : ""}`}
            href={`/chat/${character.key}`}
            aria-current={activeCharacterKey === character.key ? "page" : undefined}
            key={character.key}
          >
            <span className={`avatar ${character.avatarClass}`} aria-hidden="true">{character.displayName.slice(0, 1)}</span>
            <span className="conversation-contact-row__body">
              <strong>{character.displayName}</strong>
              <small>{character.roleLabel} · {character.homeLocation}</small>
            </span>
            {index === 0 ? <span className="conversation-contact-row__marker" aria-label="已置顶">置顶</span> : null}
          </Link>
        ))}
      </nav>

      <div className="conversation-contact-rail__footer">
        <Link href="/chat#introductions" className="conversation-contact-rail__request">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17 8v6M14 11h6" /></svg>
          <span>查看介绍请求</span>
        </Link>
        <p>新的角色会在真实介绍发生后出现在这里。</p>
      </div>
    </aside>
  );
}
