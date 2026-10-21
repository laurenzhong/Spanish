export type PlyrInstance = {
  currentTime: number;
  /**
   * Plyr exposes playback speed as an accessor pair. Assigning it updates
   * `config.speed.selected` and the underlying media `playbackRate`, so a
   * visible workbench control and Plyr's own settings menu stay in agreement.
   */
  speed: number;
  elements?: { controls?: HTMLElement; container?: HTMLElement };
  media?: HTMLElement & { error?: { code?: number } };
  play(): Promise<void> | void;
  pause(): void;
  on(event: string, callback: () => void): void;
  off(event: string, callback: () => void): void;
  destroy(): void;
};

export type PlyrConstructor = new (target: HTMLElement, options: Readonly<Record<string, unknown>>) => PlyrInstance;

/**
 * Keep the player contract visible in the DOM as well as in package.json. The
 * marker makes it possible to verify a deployed page without relying on a
 * browser-specific control skin (and catches an old cached player immediately).
 */
export const PLYR_VERSION = "3.8.4" as const;
export type PlyrMediaKind = "audio" | "video";

/**
 * Speeds offered by the visible workbench control. Keep every value inside
 * Plyr's own `speed.options` list below so the two controls agree about the
 * current rate instead of overwriting each other.
 */
export const MEDIA_PLAYBACK_SPEEDS = [0.75, 1, 1.25] as const;
export type MediaPlaybackSpeed = (typeof MEDIA_PLAYBACK_SPEEDS)[number];
export const DEFAULT_MEDIA_PLAYBACK_SPEED: MediaPlaybackSpeed = 1;

export function isMediaPlaybackSpeed(value: number): value is MediaPlaybackSpeed {
  return (MEDIA_PLAYBACK_SPEEDS as readonly number[]).includes(value);
}

/** Compact "0.75x" label that fits the shared sentence-control row. */
export function mediaPlaybackSpeedLabel(speed: number): string {
  return `${speed}x`;
}

/**
 * Apply a speed selected outside Plyr's settings menu. Assigning `speed`
 * before the instance finishes bootstrapping is safe: Plyr clamps the value
 * and defers the media update.
 */
export function applyPlyrSpeed(player: PlyrInstance | null | undefined, speed: number): void {
  if (!player || !Number.isFinite(speed)) return;
  player.speed = speed;
}

export type MountedAutoPauseControl = Readonly<{
  destroy: () => void;
  setAutoPause: (enabled: boolean) => void;
}>;

/**
 * The media detail route used to render native controls. A tab that was
 * opened before the Plyr rollout can retain that attribute while React
 * hydrates or navigates in place, so clear it before mounting the shared
 * player as well as omitting it from JSX.
 */
export function disableNativeMediaControls(element: HTMLMediaElement): void {
  element.controls = false;
  element.removeAttribute("controls");
}

/**
 * Mark the wrapper created by Plyr. The fallback is useful for controlled
 * fakes in unit tests; the real Plyr instance always exposes `elements.container`.
 */
export function markPlyrContainer(
  player: Readonly<PlyrInstance>,
  fallback: HTMLElement,
  kind: PlyrMediaKind,
): HTMLElement {
  const container = player.elements?.container ?? fallback;
  container.dataset.mediaPlayer = "plyr";
  container.dataset.mediaPlayerVersion = PLYR_VERSION;
  container.dataset.mediaPlayerKind = kind;
  return container;
}

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
