import { expect, test } from "@playwright/test";

/**
 * The public home is the only surface an anonymous visitor sees, and its whole
 * argument is a silent recording of the real product. These checks cover what a
 * unit test cannot: that the poster actually loads, that the recording decodes
 * and plays in a real browser, and that a viewport downloads the poster once
 * instead of twice.
 */
test("plays the real product recording in the first viewport", async ({ page }) => {
  const failed: string[] = [];
  const posterResponses: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
    if (response.url().includes("midnight-sun-kiruna-poster")) posterResponses.push(response.url());
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // The accessible name must not depend on the breakpoint. Rendering the two
  // clauses as block boxes inserted a space here and made the phone heading
  // announce differently from the desktop one.
  await expect(page.getByRole("heading", { name: "把认识的西语，变成真正说得出口的话。", exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Sueño — 把认识的西语，变成真正说得出口的话");
  // The dark top band has to reach the iOS Safari toolbar, or the app's cream
  // paints over the top of the page.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#10201d");

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The test project must define a viewport size.");

  // The primary action belongs above the fold on both projects.
  const callToAction = page.locator(".landing-hero__intro").getByRole("link", { name: /进入学习/ });
  await expect(callToAction).toBeVisible();
  const callToActionBox = await callToAction.boundingBox();
  if (!callToActionBox) throw new Error("The hero call to action must have a box.");
  expect(callToActionBox.y + callToActionBox.height).toBeLessThan(viewport.height);

  // Chinese breaks anywhere by default, and 西语 used to be split across two
  // lines on phones. A nowrap span reports exactly one client rect. (Whether the
  // two clauses share a line or stack is a design detail that changes with the
  // viewport, so only the word integrity is pinned here.)
  const nounRects = await page.locator(".landing-hero__keep").evaluate((element) => element.getClientRects().length);
  expect(nounRects).toBe(1);
  const headline = await page.locator("h1").boundingBox();
  if (!headline) throw new Error("The headline must have a box.");
  // A quiet headline: three lines at most, and never as tall as the recording.
  expect(headline.height).toBeLessThan(140);

  const video = page.locator(".landing-demo__video");
  await expect(video).toBeVisible();
  const videoBox = await video.boundingBox();
  if (!videoBox) throw new Error("The recording must have a box.");
  // The recording is the hero visual, so it starts inside the first viewport.
  expect(videoBox.y).toBeLessThan(viewport.height * 0.8);
  expect(Math.abs(videoBox.width / videoBox.height - 960 / 514)).toBeLessThan(0.02);

  // The poster is the largest paint; exactly one request, and it landed.
  expect(posterResponses).toHaveLength(1);

  // The page starts the recording itself and the minute actually runs. The
  // clip has no audio track, so muted autoplay is never a surprise.
  expect(await video.evaluate((element: HTMLVideoElement) => element.muted)).toBe(true);
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLVideoElement>(".landing-demo__video");
    return Boolean(element && !element.paused && element.currentTime > 0.4);
  }, undefined, { timeout: 30000 });

  // Every primary control is a 44px target, the way the stylesheet claims.
  for (const selector of [".landing-nav__cta", ".landing-hero__actions .landing-button", ".landing-hero__actions .landing-text-button", ".landing-demo__mark"]) {
    const target = await page.locator(selector).first().boundingBox();
    expect(target, `${selector} must be laid out`).not.toBeNull();
    expect(target?.height ?? 0, `${selector} must be a 44px target`).toBeGreaterThanOrEqual(44);
  }

  // The burned-in subtitles also exist as text: a screen reader cannot read the
  // picture, and a 320px phone cannot enlarge it.
  const transcript = page.locator(".landing-demo__transcript");
  await expect(transcript).toBeVisible();
  await expect(transcript.locator('p[lang="es"]').first()).toBeHidden();
  await transcript.locator("summary").click();
  await expect(transcript.locator('p[lang="es"]').first()).toBeVisible();
  await expect(transcript).toContainText("在这个美丽的场景里");

  // The three markers jump to the transcript lines they name.
  const marker = page.getByRole("button", { name: /^跳到 31:41/ });
  await expect(marker).toBeVisible();
  await marker.click();
  await page.waitForFunction(() => {
    const element = document.querySelector<HTMLVideoElement>(".landing-demo__video");
    return Boolean(element && element.currentTime > 40 && !element.paused);
  }, undefined, { timeout: 20000 });

  expect(failed).toEqual([]);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test.describe("public home in a dark system", () => {
  test.use({ colorScheme: "dark" });

  test("follows the system colour scheme, unless the visitor chose light", async ({ page }) => {
    const luminanceOf = `(value) => {
      const parts = (value.match(/[\\d.]+/g) ?? []).map(Number);
      const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * channel(parts[0]) + 0.7152 * channel(parts[1]) + 0.0722 * channel(parts[2]);
    }`;
    const read = async () =>
      page.evaluate(
        (source) => {
          const luminance = eval(source) as (value: string) => number;
          const main = document.querySelector(".landing-page") as HTMLElement;
          const card = document.querySelector(".landing-card") as HTMLElement;
          const mainStyle = getComputedStyle(main);
          const cardStyle = getComputedStyle(card);
          return {
            colorScheme: mainStyle.colorScheme,
            page: luminance(mainStyle.backgroundColor),
            text: luminance(mainStyle.color),
            card: luminance(cardStyle.backgroundColor),
          };
        },
        luminanceOf,
      );

    await page.goto("/");
    const dark = await read();
    expect(dark.colorScheme).toBe("dark");
    expect(dark.page).toBeLessThan(0.05);
    expect(dark.text).toBeGreaterThan(0.75);
    // Surfaces come forward as they lift off the page.
    expect(dark.card).toBeGreaterThan(dark.page);

    // An explicit light choice in the app outranks the system setting.
    await page.addInitScript(() => window.localStorage.setItem("spanish-theme", "light"));
    await page.goto("/");
    const chosenLight = await read();
    expect(chosenLight.colorScheme).toBe("light");
    expect(chosenLight.page).toBeGreaterThan(0.75);
  });
});
