/**
 * Loading UI for the conversation workspace.
 *
 * Choosing a contact has to feel like switching a pane, not like opening a new
 * page, so these placeholders are shaped like the workspace itself instead of a
 * generic "正在准备内容" page notice. The contact rail belongs to the chat
 * layout, so only the rail needs a skeleton of its own while its first paint
 * streams in; the pane keeps a separate thread frame.
 */
export function ConversationRailSkeleton() {
  return (
    <aside className="conversation-contact-rail conversation-contact-rail--pending" aria-busy="true">
      <div className="conversation-contact-rail__heading">
        <h2>对话</h2>
      </div>
      <p className="conversation-contact-rail__state" role="status" aria-live="polite">
        正在加载会话……
      </p>
    </aside>
  );
}

export function ConversationThreadSkeleton() {
  return (
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
  );
}
