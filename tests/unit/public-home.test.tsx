import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage, { metadata, viewport } from "@/app/page";
import PublicHomeExperience from "@/app/public-home-experience";

const demo = {
  // One silent minute of the real workbench playing
  // "El sol de medianoche en Kiruna, Suecia" with the bilingual transcript.
  video: "/public-home/midnight-sun-kiruna.mp4",
  poster: "/public-home/midnight-sun-kiruna-poster.webp",
};

/**
 * The public home is the only surface an anonymous visitor sees. It is a
 * product page: the headline is quiet, the real recording carries the page, and
 * the capabilities are listed as small cards. This suite pins that contract —
 * including that the recording it advertises is actually in the repository,
 * which a missing asset would silently break in a deployed build.
 */
describe("public home", () => {
  afterEach(() => cleanup());

  it("keeps the concept hierarchy and real entry points visible", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { name: "把认识的西语，变成真正说得出口的话。" })).toBeInTheDocument();

    // Every entry point the header, hero and closing section offer.
    expect(screen.getAllByRole("link", { name: /进入学习/ })[0]).toHaveAttribute("href", "/login?next=%2Flearn");
    const publicNavigation = screen.getByRole("navigation", { name: "公开页面导航" });
    expect(within(publicNavigation).getByRole("link", { name: "产品方式" })).toHaveAttribute("href", "#how-it-works");
    expect(within(publicNavigation).getByRole("link", { name: "阅读" })).toHaveAttribute("href", "/login?next=%2Fread");
    expect(within(publicNavigation).getByRole("link", { name: "登录" })).toHaveAttribute("href", "/login");

    expect(screen.getByRole("heading", { name: "里面有什么" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "一次练习的闭环" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "进步属于你" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "下一句话，从你自己的声音开始。" })).toBeInTheDocument();
  });

  it("keeps the headline in two unbreakable clauses", () => {
    const { container } = render(<PublicHomeExperience />);
    const heading = screen.getByRole("heading", { level: 1 });

    // Chinese has no spaces, so the default breaker splits words across lines
    // (把认识的西 / 语). The phone layout breaks between these two clauses and
    // the noun in the middle is glued — with plain inline text, because a block
    // box would change the heading's accessible name.
    const clauses = heading.querySelectorAll(":scope > span");
    expect(clauses).toHaveLength(2);
    expect(clauses[0]).toHaveTextContent("把认识的西语，");
    expect(clauses[1]).toHaveTextContent("变成真正说得出口的话。");
    expect(container.querySelectorAll(".landing-hero__keep")).toHaveLength(1);
  });

  it("plays the real recording instead of describing it", () => {
    const { container } = render(<PublicHomeExperience />);
    const video = container.querySelector("video");

    expect(video).not.toBeNull();
    expect(video).toHaveAttribute("poster", demo.poster);
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAttribute("preload", "metadata");
    // iOS Safari needs playsinline or it takes the video full screen, and the
    // clip carries no audio track at all, so autoplay can never make noise.
    expect(video).toHaveAttribute("playsinline");
    // React sets `muted` as a DOM property, not an attribute.
    expect((video as HTMLVideoElement).muted).toBe(true);
    // Autoplay is started in an effect, not by the attribute: a visitor who
    // asked for reduced motion keeps the poster instead.
    expect(video).not.toHaveAttribute("autoplay");
    expect(video?.getAttribute("aria-label")).toMatch(/双语|字幕/);
    expect(video).toHaveAttribute("width", "960");
    expect(video).toHaveAttribute("height", "514");
    const source = container.querySelector("video source");
    expect(source).toHaveAttribute("src", demo.video);
    expect(source).toHaveAttribute("type", "video/mp4");
  });

  it("starts the recording by itself once the document has loaded", () => {
    const play = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);

    render(<PublicHomeExperience />);
    // Autoplay waits for `load` so the megabyte cannot race the first paint.
    window.dispatchEvent(new Event("load"));

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("jumps to a real transcript line when a marker is pressed", () => {
    const play = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
    const { container } = render(<PublicHomeExperience />);
    window.dispatchEvent(new Event("load"));
    play.mockClear();

    const markers = screen.getAllByRole("button", { name: /^跳到 / });
    expect(markers).toHaveLength(3);
    expect(markers[0]).toHaveAccessibleName(/31:12/);

    fireEvent.click(markers[1]);

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.currentTime).toBe(18);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("leaves the recording on its poster when the visitor asked for reduced motion", () => {
    const play = vi.fn(() => Promise.resolve());
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as never);
    // jsdom ships no matchMedia, so the helper is stubbed through the window
    // rather than spied on.
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }),
    });

    try {
      render(<PublicHomeExperience />);
      window.dispatchEvent(new Event("load"));
      expect(play).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, "matchMedia", original);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("ships the recording and its poster", () => {
    for (const [url, minBytes] of [[demo.video, 500_000], [demo.poster, 10_000]] as const) {
      const file = path.join(process.cwd(), "public", url.replace(/^\//, ""));
      expect(existsSync(file), `${url} must exist under public/`).toBe(true);
      expect(statSync(file).size, `${url} must be a real asset`).toBeGreaterThan(minBytes);
    }
  });

  it("preloads the poster once, not the 700 KB recording", () => {
    render(<PublicHomeExperience />);

    const preloads = [...document.querySelectorAll('link[rel="preload"][as="image"]')].map((link) => ({
      href: link.getAttribute("href"),
      type: link.getAttribute("type"),
    }));
    expect(preloads).toEqual([{ href: demo.poster, type: "image/webp" }]);
    // The video body stays on the server until the visitor presses play.
    const videoPreloads = [...document.querySelectorAll('link[rel="preload"][as="video"]')];
    expect(videoPreloads).toHaveLength(0);
  });

  it("offers the burned-in subtitles as readable text", () => {
    const { container } = render(<PublicHomeExperience />);
    const transcript = container.querySelector(".landing-demo__transcript");

    expect(transcript).not.toBeNull();
    // Closed by default: it is a detail, not a wall of text.
    expect(transcript).not.toHaveAttribute("open");
    expect(screen.getByText("实录里说了什么")).toBeInTheDocument();

    const lines = [...(transcript?.querySelectorAll("li") ?? [])];
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // The published Spanish line and its published Chinese translation,
      // never a paraphrase written for the landing page.
      expect(line.querySelector('p[lang="es"]')?.textContent?.trim()).toBeTruthy();
      expect(line.querySelector("p:not([lang])")?.textContent?.trim()).toBeTruthy();
    }
    expect(transcript?.textContent).toMatch(/medianoche|agradecido|gracias/);
    expect(transcript?.textContent).toMatch(/这次冒险就要结束了/);
  });

  it("lists the capabilities as small cards with icons", () => {
    const { container } = render(<PublicHomeExperience />);
    const cards = [...container.querySelectorAll(".landing-card")];

    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card.querySelector("svg")).not.toBeNull();
      expect(card.querySelector("h3")?.textContent?.trim()).toBeTruthy();
      // Text and nothing else: the cards carry no screenshots.
      expect(card.querySelector("img")).toBeNull();
    }

    // The cards carry the numbers the product can back up: the shelf size, the
    // published floor and the scenario count.
    const grid = container.querySelector(".landing-cards")?.textContent ?? "";
    expect(grid).toMatch(/7,922/);
    expect(grid).toMatch(/170\+ 个视频与播客版本/);
    expect(grid).toMatch(/9 个可练场景/);
  });

  it("lets a visitor step through the practice loop", () => {
    render(<PublicHomeExperience />);
    const loop = screen.getByRole("region", { name: "一次练习的闭环" });
    const steps = within(loop).getAllByRole("button");

    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(loop).getByText("¿Te apetece seguir hablando después?")).toBeInTheDocument();

    fireEvent.click(steps[2]);

    expect(steps[2]).toHaveAttribute("aria-pressed", "true");
    expect(steps[0]).toHaveAttribute("aria-pressed", "false");
    expect(within(loop).getByText("Podemos seguir mañana, si te viene bien.")).toBeInTheDocument();
  });

  it("tints the phone toolbar with the hero colour", () => {
    // The signed-in shell is cream and the top band is dark: without this the
    // iOS Safari toolbar paints the app colour over the public page. The export
    // has to live in the route segment (`app/page.tsx`), not in a component
    // file, or Next never reads it.
    expect(viewport.themeColor).toBe("#10201d");
    expect(viewport.width).toBe("device-width");
  });

  it("describes itself in the language of the page", () => {
    // The root layout's default description is English; the public page is not.
    expect(metadata.title).toEqual({ absolute: "Sueño — 把认识的西语，变成真正说得出口的话" });
    expect(String(metadata.description)).toMatch(/西语/);
  });
});
