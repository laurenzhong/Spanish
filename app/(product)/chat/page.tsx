import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "对话",
};

/**
 * The conversation workspace belongs to `layout.tsx` (contact rail) and to the
 * chosen conversation (`[characterId]/page.tsx`). Opening `/chat` therefore
 * shows the contacts on the left and leaves the right pane empty until a
 * contact is chosen - with no data read of its own.
 */
export default function ChatPage() {
  return null;
}
