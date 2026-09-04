type ConversationTypingIndicatorProps = Readonly<{
  className?: string;
}>;

function TypingVisual() {
  return (
    <>
      <span aria-hidden="true">Typing</span>
      <span className="conversation-typing-indicator__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </>
  );
}

export function ConversationTypingIndicator({
  className,
}: ConversationTypingIndicatorProps) {
  const classes = ["conversation-typing-indicator", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-hidden="true">
      <TypingVisual />
    </span>
  );
}
