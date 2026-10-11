import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "对话",
};

/**
 * The conversation workspace belongs to `layout.tsx` (contact rail) and to the
 * chosen conversation (`[characterId]/page.tsx`). Opening `/chat` therefore
 * shows the contacts on the left and a prompt on the right - with no data read
 * of its own.
 *
 * The prompt is hidden below 960px, where the rail already fills the pane, so
 * the two never compete for the same space.
 */
export default function ChatPage() {
  return (
    <section className="conversation-empty" aria-labelledby="conversation-empty-title">
      <h2 id="conversation-empty-title">选择一个好友开始对话</h2>
      <p>从左侧联系人里选一位，接着上次的话题说下去。你和每位角色的对话只属于你们两个人。</p>
    </section>
  );
}
