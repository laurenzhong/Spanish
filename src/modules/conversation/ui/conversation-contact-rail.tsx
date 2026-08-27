import Link from "next/link";

type ConversationContactRailProps = Readonly<{
  activeCharacterKey?: "lucia";
}>;

export function ConversationContactRail({ activeCharacterKey }: ConversationContactRailProps) {
  const isLuciaActive = activeCharacterKey === "lucia";

  return (
    <aside className="conversation-contact-rail" aria-label="联系人">
      <div className="conversation-contact-rail__heading">
        <div>
          <p className="eyebrow eyebrow--accent">私信</p>
          <h2>对话</h2>
        </div>
        <span className="conversation-contact-rail__count">1 位角色</span>
      </div>

      <div className="conversation-contact-rail__search" aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
        <span>搜索对话</span>
      </div>

      <p className="conversation-contact-rail__label">最近</p>
      <nav className="conversation-contact-rail__list" aria-label="好友列表">
        <Link
          className={`conversation-contact-row ${isLuciaActive ? "conversation-contact-row--active" : ""}`}
          href="/chat/lucia"
          aria-current={isLuciaActive ? "page" : undefined}
        >
          <span className="avatar avatar--lucia" aria-hidden="true">L</span>
          <span className="conversation-contact-row__body">
            <strong>Lucía Martín</strong>
            <small>主要好友 · 文字和语音都可以</small>
          </span>
          <span className="conversation-contact-row__marker" aria-label="已置顶">置顶</span>
        </Link>
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
