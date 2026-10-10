import type { ReactNode } from "react";
import { Suspense } from "react";

import { ConversationRailSkeleton } from "@/src/modules/conversation/ui/conversation-workspace-skeleton";

import ContactRailWithFirstPaint from "./_contact-rail-data";

/**
 * The conversation workspace owns its contact rail here rather than in each
 * page: a layout is mounted once and reused while the user switches between
 * `/chat` and `/chat/[characterId]`, so the contact list is read once per page
 * load and never again on a contact switch. That is the whole point of the
 * chat-client layout - switching panes must not pay for the list or the
 * conversation again.
 *
 * The rail streams behind its own boundary, so the workspace shell and the pane
 * paint immediately while the list arrives with the first response.
 */
export default function ChatLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="page-stack chat-page conversation-page conversation-page--detail">
      <div className="conversation-workspace">
        <Suspense fallback={<ConversationRailSkeleton />}>
          <ContactRailWithFirstPaint />
        </Suspense>
        {children}
      </div>
    </div>
  );
}
