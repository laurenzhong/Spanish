import { strict as assert } from "node:assert";
import { chromium } from "@playwright/test";

// Native Chrome engine start/end, not speaker listening or Safari acceptance.
// Read-only; no fake TTS, audio downloads or playback URLs in logs.
const base = process.env.VOCAB_AUDIO_BASE ?? "http://127.0.0.1:3211";
const userId = "11111111-1111-4111-8111-111111111111";
type SpeechAttempt = { text: string; lang: string; started: boolean; ended: boolean; errors: string[] };
type Capture = { attempts: SpeechAttempt[]; mediaCreated: number };
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addCookies([{ name: "spanish-e2e-user", value: userId, url: base }]);
    await context.addInitScript(() => {
      localStorage.setItem("sueno:vocabulary-autoplay:v1:11111111-1111-4111-8111-111111111111", "off");
      const capture: Capture = { attempts: [], mediaCreated: 0 };
      Object.assign(window, { vocabularySpeechCheck: capture });
      const originalSpeak = speechSynthesis.speak.bind(speechSynthesis);
      speechSynthesis.speak = function (utterance) {
        const attempt: SpeechAttempt = { text: utterance.text, lang: utterance.lang, started: false, ended: false, errors: [] };
        capture.attempts.push(attempt);
        utterance.addEventListener("start", () => { attempt.started = true; });
        utterance.addEventListener("end", () => { attempt.ended = true; });
        utterance.addEventListener("error", (event) => { attempt.errors.push(event.error); });
        originalSpeak(utterance);
      };
      const OriginalAudio = window.Audio;
      window.Audio = function () {
        capture.mediaCreated += 1;
        return new OriginalAudio();
      } as unknown as typeof Audio;
    });
    const page = await context.newPage();
    let wordAudioRequests = 0;
    let mediaRequests = 0;
    const errors: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/read/word-audio")) wordAudioRequests += 1;
      if (request.resourceType() === "media") mediaRequests += 1;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    for (const autoplay of [false, true]) {
      await page.goto(`${base}/read/vocabulary?search=suponer`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="点词自动发音"]')?.checked === false);
      if (autoplay) await page.getByRole("checkbox", { name: "点词自动发音" }).check();
      await page.locator('[data-word-key="suponer"]').click();
      if (!autoplay) await page.getByRole("button", { name: "朗读单词", exact: true }).click();
      await page.waitForFunction(() => {
        const attempts = (window as unknown as { vocabularySpeechCheck: Capture }).vocabularySpeechCheck.attempts;
        return attempts.length > 0 && attempts.every((attempt) => attempt.ended);
      }, undefined, { timeout: 30_000 });
      const capture = await page.evaluate(() => (window as unknown as { vocabularySpeechCheck: Capture }).vocabularySpeechCheck);
      assert.equal(capture.attempts.length, 1);
      assert.deepEqual(capture.attempts[0], { text: "suponer", lang: "es-ES", started: true, ended: true, errors: [] });
      assert.equal(capture.mediaCreated, 0);
      assert.equal(wordAudioRequests, 0);
      assert.equal(mediaRequests, 0);
      await page.getByRole("button", { name: "朗读单词", exact: true }).waitFor();
      assert.equal(await page.getByText(/原声 ·/).count(), 0);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const panel = await page.locator(".vocabulary-study__card").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { width: box.width, right: box.right, position: getComputedStyle(element).position };
      });
      if (width === 375) assert.equal(panel.position, "fixed");
      else assert(panel.width >= 430 && panel.width <= 450 && panel.right <= width);
      console.log(`PASS native es-ES suponer start/end, no media, reset, layout: ${width}px ${autoplay ? "autoplay" : "manual"}`);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
