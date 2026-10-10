import { ConversationContactRail } from "./conversation-contact-rail";

type ConversationWorkspaceSkeletonProps = Readonly<{
  /**
   * `workspace` is the contact index: the right pane stays empty until a
   * conversation is chosen. `detail` adds the thread frame that the chosen
   * conversation fills in.
   */
  variant: "workspace" | "detail";
}>;

/**
 * Route-level loading UI for the conversation workspace.
 *
 * Choosing a contact has to feel like switching a pane, not like opening a new
 * page. The fallback therefore already renders the contact rail and the thread
 * frame instead of a generic "正在准备内容" placeholder: the rail paints from
 * its module-level cache, so the contact list and its scroll position survive
 * the switch, and the thread frame is where the conversation appears.
 *
 * `loading.tsx` receives no route params, so the frame stays anonymous and the
 * active contact highlight is applied by the page itself one render later.
 */
export function ConversationWorkspaceSkeleton({ variant }: ConversationWorkspaceSkeletonProps) {
  return (
    <div className={`page-stack chat-page conversation-page conversation-page--${variant}`}>
      <div className="conversation-workspace">
        <ConversationContactRail />
        {variant === "detail" ? (
          <section
            className="conversation-thread conversation-thread--pending"
            aria-busy="true"
            data-testid="conversation-thread-pending"
          >
            <div className="conversation-thread__header" aria-hidden="true" />
            <div className="conversation-thread__messages">
              <div className="conversation-thread__loading" role="status" aria-live="polite">
                <span />
                <span />
                <span />
                正在打开对话……
              </div>
            </div>
            <div className="conversation-thread__composer-loading">正在准备对话……</div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
