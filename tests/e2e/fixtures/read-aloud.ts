import type { Page } from "@playwright/test";

/** Exercise the authenticated shared endpoint without sending billable requests.
 * Playback events are controlled separately from fetch and play() completion.
 */
export async function installReadAloud(page: Page, options: { autoStart?: boolean; endAfterMs?: number } = {}) {
  await page.route("**/api/v1/tts", (route) => route.fulfill({
    status: 200,
    contentType: "audio/mpeg",
    // The media API is faked below; keep the real client's MP3 signature check.
    body: Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]),
  }));
  await page.addInitScript(({ autoStart, endAfterMs }) => {
    // The selected website voice must work without a system speech engine.
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    const trace: { text: string; lang: string }[] = [];
    const audios: { dispatchEvent(event: Event): boolean }[] = [];
    Reflect.set(window, "readAloudTrace", trace);
    Reflect.set(window, "readAloudAudios", audios);
    Reflect.set(window, "readAloudPauses", 0);
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (String(input).endsWith("/api/v1/tts") && typeof init?.body === "string") {
        const request = JSON.parse(init.body) as { text: string; languageTag: string };
        trace.push({ text: request.text, lang: request.languageTag });
        Reflect.set(window, "__wordSpeech", trace.at(-1));
      }
      return originalFetch(input, init);
    };
    const synthetic = new WeakSet<HTMLMediaElement>();
    const listeners = new WeakMap<HTMLMediaElement, Map<string, Set<EventListenerOrEventListenerObject>>>();
    const add = HTMLMediaElement.prototype.addEventListener;
    const remove = HTMLMediaElement.prototype.removeEventListener;
    HTMLMediaElement.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      if (synthetic.has(this) && listener) {
        const events = listeners.get(this) ?? new Map();
        const handlers = events.get(type) ?? new Set();
        handlers.add(listener);
        events.set(type, handlers);
        listeners.set(this, events);
        return;
      }
      if (listener) return add.call(this, type, listener, options);
    };
    HTMLMediaElement.prototype.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      if (synthetic.has(this)) {
        if (listener) listeners.get(this)?.get(type)?.delete(listener);
        return;
      }
      if (listener) return remove.call(this, type, listener, options);
    };
    const play = HTMLMediaElement.prototype.play;
    const pause = HTMLMediaElement.prototype.pause;
    const load = HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.play = function () {
      if (!(this instanceof HTMLAudioElement)) return play.call(this);
      if (this.src.startsWith("data:audio/")) { synthetic.add(this); return Promise.resolve(); }
      if (!this.src.startsWith("blob:")) return play.call(this);
      // Retain old callback snapshots so tests can deliver stale events after a switch.
      const snapshot = new Map([...listeners.get(this) ?? []].map(([type, handlers]) => [type, [...handlers].map((handler) => (event: Event) => {
        if (typeof handler === "function") handler.call(this, event);
        else handler.handleEvent(event);
      })]));
      const record = {
        dispatchEvent(event: Event) {
          for (const handler of snapshot.get(event.type) ?? []) handler(event);
          return true;
        },
      };
      audios.push(record);
      if (autoStart) queueMicrotask(() => record.dispatchEvent(new Event("playing")));
      if (endAfterMs !== undefined) setTimeout(() => record.dispatchEvent(new Event("ended")), endAfterMs);
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      if (!synthetic.has(this)) return pause.call(this);
      if (this.src.startsWith("blob:")) Reflect.set(window, "readAloudPauses", Reflect.get(window, "readAloudPauses") + 1);
    };
    HTMLMediaElement.prototype.load = function () {
      if (!synthetic.has(this)) return load.call(this);
    };
  }, { autoStart: options.autoStart ?? true, endAfterMs: options.endAfterMs });
}
