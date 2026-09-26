export type PlyrInstance = {
  currentTime: number;
  elements?: { controls?: HTMLElement; container?: HTMLElement };
  media?: HTMLElement & { error?: { code?: number } };
  play(): Promise<void> | void;
  pause(): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  destroy(): void;
};

export type PlyrConstructor = new (target: HTMLElement, options: Readonly<Record<string, unknown>>) => PlyrInstance;

export type MountedAutoPauseControl = Readonly<{
  destroy: () => void;
  setAutoPause: (enabled: boolean) => void;
}>;

export const audioPlyrOptions = {
  controls: ["play", "progress", "current-time", "duration", "mute", "volume", "settings"],
  iconUrl: "/plyr.svg",
  keyboard: { focused: true, global: false },
  loadSprite: true,
  settings: ["speed"],
  speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] },
  tooltips: { controls: true, seek: true },
} as const;

export const videoPlyrOptions = {
  controls: ["play-large", "play", "progress", "current-time", "mute", "volume", "settings", "pip", "fullscreen"],
  iconUrl: "/plyr.svg",
  keyboard: { focused: true, global: false },
  loadSprite: true,
  tooltips: { controls: true, seek: true },
  ratio: "16:9",
  settings: ["speed"],
} as const;

export function mountPlyrAutoPauseControl(player: Readonly<{ elements?: { controls?: HTMLElement } }>, input: Readonly<{
  autoPause: boolean;
  disabled: boolean;
  onToggleAutoPause: () => void;
}>): MountedAutoPauseControl | null {
  const controls = player.elements?.controls;
  if (!controls) return null;
  const autoPauseButton = document.createElement("button");
  autoPauseButton.className = "plyr__control plyr__controls__item media-plyr-auto-pause-control";
  autoPauseButton.dataset.mediaAutoPauseControl = "";
  autoPauseButton.type = "button";
  autoPauseButton.disabled = input.disabled;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.innerHTML = '<path d="M4 6.5h10M4 11h8M4 15.5h10M19 5v14M16 19h3" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/>';
  autoPauseButton.appendChild(icon);
  const onClick = (event: Event) => {
    event.stopPropagation();
    input.onToggleAutoPause();
  };
  autoPauseButton.addEventListener("click", onClick);
  const setAutoPause = (enabled: boolean) => {
    autoPauseButton.setAttribute("aria-pressed", String(enabled));
    const label = input.disabled ? "暂无已审核分句，无法自动暂停" : enabled ? "关闭自动暂停" : "开启自动暂停";
    autoPauseButton.title = label;
    autoPauseButton.setAttribute("aria-label", label);
  };
  setAutoPause(input.autoPause);
  controls.prepend(autoPauseButton);
  return {
    destroy: () => {
      autoPauseButton.removeEventListener("click", onClick);
      autoPauseButton.remove();
    },
    setAutoPause,
  };
}
