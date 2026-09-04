type SurfaceStateName = "loading" | "empty" | "error" | "offline";

type SurfaceStateProps = Readonly<{
  action?: () => void;
  description?: string;
  state: SurfaceStateName;
}>;

const stateContent: Record<
  SurfaceStateName,
  { title: string; description: string; marker: string }
> = {
  loading: {
    title: "正在准备内容",
    description: "稍等一下，你的学习位置马上就好。",
    marker: "…",
  },
  empty: {
    title: "这里还没有内容",
    description: "完成第一次学习后，这里会出现与你有关的记录。",
    marker: "○",
  },
  error: {
    title: "暂时无法载入",
    description: "本次技术问题不会影响你的能力记录，可以稍后重试。",
    marker: "!",
  },
  offline: {
    title: "当前处于离线状态",
    description: "已保存内容仍可查看，联网后再继续需要同步的步骤。",
    marker: "↯",
  },
};

export function SurfaceState({ action, description, state }: SurfaceStateProps) {
  const content = stateContent[state];

  return (
    <section
      aria-live={state === "loading" ? "polite" : undefined}
      className={`surface-state surface-state--${state}`}
    >
      <span className="surface-state__marker" aria-hidden="true">
        {state === "loading" ? (
          <span className="surface-state__loading-dots">
            <i className="surface-state__dot" />
            <i className="surface-state__dot" />
            <i className="surface-state__dot" />
          </span>
        ) : content.marker}
      </span>
      <h2>{content.title}</h2>
      <p>{description ?? content.description}</p>
      {action ? (
        <button className="secondary-action" onClick={action} type="button">
          重新载入
        </button>
      ) : null}
    </section>
  );
}
