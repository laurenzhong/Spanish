import { strict as assert } from "node:assert";
import { chromium } from "@playwright/test";

// Read-only against an AUTH_E2E_ENABLED server with a populated vocabulary shelf.
// Deterministic layout checks fake media. Real recordings stream without being
// saved; each must advance, end and decode to a nonzero waveform.
const base = process.env.TATOEBA_BROWSER_BASE ?? "http://127.0.0.1:3211";
const browser = await chromium.launch({ channel: "chrome" });
try {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"], reducedMotion: "reduce" });
  await context.addCookies([{ name: "spanish-e2e-user", value: "11111111-1111-4111-8111-111111111111", url: base }]);
  await context.addInitScript(() => {
    localStorage.setItem("sueno:vocabulary-autoplay:v1:11111111-1111-4111-8111-111111111111", "off");
    class FakeAudio {
      src = ""; currentTime = 0; preload = ""; ended = false;
      onplaying: (() => void) | null = null; onended: (() => void) | null = null; onerror: (() => void) | null = null;
      ontimeupdate: (() => void) | null = null; onwaiting: (() => void) | null = null;
      pause() {} load() {} removeAttribute() {}
      play() { setTimeout(() => { this.onplaying?.(); this.currentTime = .25; this.ontimeupdate?.(); }, 100); return Promise.resolve(); }
    }
    Object.defineProperty(window, "Audio", { value: FakeAudio, configurable: true });
    let speechGeneration = 0;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => [],
      cancel: () => { speechGeneration += 1; },
      speak: (utterance: SpeechSynthesisUtterance) => {
        const generation = ++speechGeneration;
        setTimeout(() => { if (generation === speechGeneration) utterance.onstart?.(new Event("start") as SpeechSynthesisEvent); }, 100);
      },
    } });
  });
  const page = await context.newPage();
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/read/vocabulary?search=haber`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      // The SSR checkbox is on; the stored off preference becomes visible only
      // after hydration. Wait for that before exercising delegated tile clicks.
      await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="点词自动发音"]')?.checked === false);
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      await page.locator('[data-word-key="haber"]').click();
      const row = page.locator(".vocabulary-study__tatoeba li").filter({ hasText: "¿Habéis dormido?" });
      await row.getByRole("button", { name: "播放例句原声" }).waitFor();
      await row.getByRole("button", { name: "复制例句" }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "¿Habéis dormido?");
      await row.getByRole("button", { name: "播放例句原声" }).click();
      await row.getByRole("button", { name: "停止例句原声" }).waitFor();
      // Clicking play shows no status line; only the button reports loading/playing.
      assert.equal(await row.getByText(/正在(加载|播放)例句原声/u).count(), 0);
      await page.waitForFunction(() => {
        const item = [...document.querySelectorAll<HTMLElement>(".vocabulary-study__tatoeba li")]
          .find((candidate) => candidate.textContent?.includes("¿Habéis dormido?"));
        const button = item?.querySelector<HTMLButtonElement>('button[aria-label="停止例句原声"]');
        return Boolean(button) && button?.getAttribute("aria-busy") !== "true";
      });
      await row.getByRole("button", { name: "停止例句原声" }).click();
      await row.getByRole("button", { name: "播放例句原声" }).waitFor();
      const synthetic = page.locator(".vocabulary-study__tatoeba li").filter({ hasText: "¿Habéis despertado?" });
      await synthetic.getByRole("button", { name: "合成朗读例句" }).click();
      await synthetic.getByRole("button", { name: "停止合成朗读" }).waitFor();
      assert.equal(await synthetic.getByText(/正在(准备|合成)朗读/u).count(), 0);
      await synthetic.getByRole("button", { name: "停止合成朗读" }).click();
      await synthetic.getByRole("button", { name: "合成朗读例句" }).waitFor();
      const boxes = await row.locator("button").evaluateAll((buttons) => buttons.map((button) => {
        const box = button.getBoundingClientRect(); return { width: box.width, height: box.height, left: box.left, right: box.right };
      }));
      assert(boxes.every((box) => box.width >= 44 && box.height >= 44 && box.left >= 0 && box.right <= width));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: `.tmp-tatoeba-audio-${theme}-${width}.png` });
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      console.log(`PASS copy/original/synthetic/stop/layout: ${theme} ${width}px`);
    }
  }
  await context.close();

  const realContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await realContext.addCookies([{ name: "spanish-e2e-user", value: "11111111-1111-4111-8111-111111111111", url: base }]);
  await realContext.addInitScript(() => {
    localStorage.setItem("sueno:vocabulary-autoplay:v1:11111111-1111-4111-8111-111111111111", "off");
    const OriginalAudio = window.Audio;
    const capture = { started: false, advanced: false, ended: false, source: "", muted: false, volume: 1, created: 0, events: [] as { event: string; source: string; time: number }[] };
    Object.assign(window, { tatoebaAudioCheck: capture });
    const synthetic = { started: false, ended: false, text: "", lang: "", errors: [] as string[] };
    Object.assign(window, { tatoebaSyntheticCheck: synthetic });
    const originalSpeak = speechSynthesis.speak.bind(speechSynthesis);
    speechSynthesis.speak = function (utterance) {
      if (utterance.text === "¿Habéis despertado?") {
        synthetic.text = utterance.text; synthetic.lang = utterance.lang;
        utterance.addEventListener("start", () => { synthetic.started = true; });
        utterance.addEventListener("end", () => { synthetic.ended = true; });
        utterance.addEventListener("error", (event) => { synthetic.errors.push(event.error); });
      }
      originalSpeak(utterance);
    };
    window.Audio = function () {
      const audio = new OriginalAudio();
      capture.created += 1;
      for (const event of ["playing", "ended", "error", "waiting", "pause"]) audio.addEventListener(event, () => {
        capture.events.push({ event, source: /^https:\/\/(api\.)?tatoeba\.org\//.test(audio.src) ? audio.src : "other-or-cleared", time: audio.currentTime });
      });
      let lastSource = "";
      audio.addEventListener("playing", () => { lastSource = audio.src; if (audio.src.startsWith("https://api.tatoeba.org/v1/audios/")) { capture.started = true; capture.source = audio.src; capture.muted = audio.muted; capture.volume = audio.volume; } });
      audio.addEventListener("timeupdate", () => { if (audio.src.startsWith("https://api.tatoeba.org/v1/audios/") && audio.currentTime > 0) capture.advanced = true; });
      // The app's onended releases src before later event listeners can read it.
      audio.addEventListener("ended", () => { if (lastSource.startsWith("https://api.tatoeba.org/v1/audios/")) capture.ended = true; });
      return audio;
    } as unknown as typeof Audio;
  });
  const realPage = await realContext.newPage();
  realPage.on("pageerror", (error) => console.log(`Page error: ${error.message}`));
  for (const sample of [
    { word: "haber", text: "¿Habéis dormido?", id: 430210, autoplay: false },
    { word: "tener", text: "Tened cuidado.", id: 523459, autoplay: false },
    { word: "ir", text: "Podemos ir.", id: 450859, autoplay: false },
    { word: "hacer", text: "Sé hacerlo.", id: 611375, autoplay: false },
    { word: "querer", text: "¿Qué queréis?", id: 194643, autoplay: false },
    { word: "haber", text: "¿Habéis dormido?", id: 430210, autoplay: true },
  ]) {
  if (sample.autoplay) {
    // The word's late recording lookup must not interrupt the example's sound.
    await realPage.route("**/api/v1/read/word-audio", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: null }) });
    });
  }
  await realPage.goto(`${base}/read/vocabulary?search=${sample.word}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await realPage.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="点词自动发音"]')?.checked === false);
  if (sample.autoplay) await realPage.getByRole("checkbox", { name: "点词自动发音" }).check();
  await realPage.locator(`[data-word-key="${sample.word}"]`).click();
  const recording = realPage.locator(".vocabulary-study__tatoeba li").filter({ hasText: sample.text });
  await recording.getByRole("button", { name: "播放例句原声" }).click();
  try {
    await realPage.waitForFunction(() => (window as unknown as { tatoebaAudioCheck: { ended: boolean } }).tatoebaAudioCheck.ended, { timeout: 30_000 });
  } catch (error) {
    console.log("Real playback diagnostic:", await realPage.evaluate(() => (window as unknown as { tatoebaAudioCheck: unknown }).tatoebaAudioCheck), await recording.innerText());
    throw error;
  }
  const check = await realPage.evaluate(() => (window as unknown as { tatoebaAudioCheck: { started: boolean; advanced: boolean; ended: boolean; source: string; muted: boolean; volume: number } }).tatoebaAudioCheck);
  assert(check.started && check.advanced && check.ended);
  assert.equal(check.source, `https://api.tatoeba.org/v1/audios/${sample.id}/file`);
  assert(!check.muted && check.volume > 0);
  await recording.getByRole("button", { name: "播放例句原声" }).waitFor();
  const waveform = await realPage.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
    const decoder = new AudioContext();
    try {
      const buffer = await decoder.decodeAudioData(await response.arrayBuffer());
      let peak = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        for (const value of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
      }
      return { duration: buffer.duration, peak };
    } finally { await decoder.close(); }
  }, check.source);
  assert(waveform.duration > 0 && waveform.peak > .01);
  if (sample.autoplay) {
    await realPage.unrouteAll({ behavior: "wait" });
    assert.equal(await realPage.getByText("合成音", { exact: true }).count(), 0);
  }
  console.log(`PASS real Tatoeba recording ${sample.word} (autoplay=${sample.autoplay}): ${JSON.stringify({ ...check, waveform })}`);
  }
  await realPage.goto(`${base}/read/vocabulary?search=haber`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await realPage.waitForFunction(() => document.querySelector<HTMLInputElement>('[aria-label="点词自动发音"]')?.checked === false);
  await realPage.waitForFunction(() => speechSynthesis.getVoices().some((voice) => voice.lang.startsWith("es")), undefined, { timeout: 2_000 }).catch(() => {});
  const hasSpanishVoice = await realPage.evaluate(() => speechSynthesis.getVoices().some((voice) => voice.lang.startsWith("es")));
  if (hasSpanishVoice) {
    await realPage.locator('[data-word-key="haber"]').click();
    const synthetic = realPage.locator(".vocabulary-study__tatoeba li").filter({ hasText: "¿Habéis despertado?" });
    await synthetic.getByRole("button", { name: "合成朗读例句" }).click();
    await realPage.waitForFunction(() => (window as unknown as { tatoebaSyntheticCheck: { ended: boolean } }).tatoebaSyntheticCheck.ended, undefined, { timeout: 30_000 });
    const check = await realPage.evaluate(() => (window as unknown as { tatoebaSyntheticCheck: { started: boolean; ended: boolean; text: string; lang: string; errors: string[] } }).tatoebaSyntheticCheck);
    assert(check.started && check.ended && check.errors.length === 0);
    assert.equal(check.text, "¿Habéis despertado?");
    assert.equal(check.lang, "es-ES");
    await synthetic.getByRole("button", { name: "合成朗读例句" }).waitFor();
    console.log(`PASS native Spanish synthesis: ${JSON.stringify(check)}`);
  } else { console.log("SKIP native synthesis: this browser has no installed Spanish voice; fake lifecycle checks passed separately."); }
  await realContext.close();
} finally { await browser.close(); }
