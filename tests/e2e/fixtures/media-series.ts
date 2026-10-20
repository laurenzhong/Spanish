import type { Page } from "@playwright/test";

export async function installSeriesMedia(page: Page, baseURL: string) {
  await page.context().addCookies([{ name: "spanish-e2e-user", value: "00000000-0000-4000-8000-000000000001", url: baseURL }]);
  await page.addInitScript(() => {
    const positions = new WeakMap<HTMLMediaElement, number>();
    const sources = new WeakMap<HTMLMediaElement, string>();
    Object.defineProperty(HTMLMediaElement.prototype, "src", {
      configurable: true, get() { return sources.get(this) ?? ""; },
      set(value: string) { sources.set(this, value); this.dataset.source = value; },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get() { return 1; } });
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get() { return positions.get(this) ?? 0; },
      set(value: number) { positions.set(this, value); this.dataset.currentTime = String(value); },
    });
    HTMLMediaElement.prototype.load = function () { setTimeout(() => this.dispatchEvent(new Event("canplay")), 0); };
    HTMLMediaElement.prototype.play = function () { this.dataset.playCalls = String(Number(this.dataset.playCalls ?? 0) + 1); this.dispatchEvent(new Event("play")); return Promise.resolve(); };
    HTMLMediaElement.prototype.pause = function () { this.dispatchEvent(new Event("pause")); };
  });
  await page.route("https://media.example.test/**", (route) => route.abort("blockedbyclient"));
}
