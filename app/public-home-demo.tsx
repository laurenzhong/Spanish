"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { prefersReducedMotion } from "@/src/shared/ui/motion";

/**
 * Three places in the recording worth jumping to, in seconds from the start of
 * the clip, with the transcript line each one lands on. They are the real
 * published subtitles, not invented chapters: the lesson itself lets a learner
 * click a subtitle to land on that moment, and the landing page shows the same
 * move with the three lines that carry the clip.
 */
const marks = [
  {
    at: 12,
    time: "31:12",
    label: "凌晨两点",
    title: "凌晨两点，这趟冒险要结束了",
    es: "en este hermoso escenario siendo las dos de la madrugada es que llegamos al final de esta aventura.",
    zh: "在这个美丽的场景里，凌晨两点，我们这次冒险就要结束了。",
  },
  {
    at: 18,
    time: "31:18",
    label: "感激这一切",
    title: "很感激能亲身经历这一切",
    es: "Wow, me siento súper agradecido de haber podido vivir esto, de haber podido hacer nuevos amigos, de poder grabar todo esto.",
    zh: "哇，我感到非常感激能够亲身体验这一切，能够结识新朋友，能够将所有这些都记录下来。",
  },
  {
    at: 41,
    time: "31:41",
    label: "谢谢陪伴",
    title: "谢谢你们又陪我走完一程",
    es: "Muchísimas gracias de corazón por haberme acompañado en una aventura más.",
    zh: "衷心感谢你们陪伴我又一次冒险。",
  },
] as const;

type PublicHomeDemoProps = Readonly<{
  poster: string;
  src: string;
  width: number;
  height: number;
  label: string;
  fallback: ReactNode;
}>;

/**
 * The hero recording: one real minute inside the workbench, with the bilingual
 * transcript following the video. It starts by itself, and because browsers only
 * allow that when the sound is off, it starts muted — the lesson's own Spanish
 * audio is one tap away on the button beside the jump marks.
 *
 * Autoplay waits for the document to finish loading: the poster is the first
 * paint, and the megabytes behind it must not race the stylesheet and the app
 * shell for the visitor's bandwidth. It is skipped entirely for visitors who
 * asked for reduced motion and for metered or 2G connections — they keep the
 * poster and the native controls instead.
 */
export function PublicHomeDemo({ poster, src, width, height, label, fallback }: PublicHomeDemoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const metered = connection?.saveData === true || /(^|-)2g$/.test(connection?.effectiveType ?? "");
    if (prefersReducedMotion() || metered) return;

    // jsdom has no media pipeline and some browsers return nothing at all.
    const play = () => {
      const started = video.play();
      if (started && typeof started.catch === "function") started.catch(() => undefined);
    };

    if (document.readyState === "complete") {
      play();
      return;
    }
    window.addEventListener("load", play, { once: true });
    return () => window.removeEventListener("load", play);
  }, []);

  // The native controls carry a mute button too, so the label follows the
  // element rather than only our own clicks.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || typeof video.addEventListener !== "function") return;
    const sync = () => setSoundOn(!video.muted && video.volume > 0);
    video.addEventListener("volumechange", sync);
    sync();
    return () => video.removeEventListener("volumechange", sync);
  }, []);

  const toggleSound = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const turnOn = video.muted || video.volume === 0;
    video.muted = !turnOn;
    if (turnOn) video.volume = 1;
    setSoundOn(turnOn);
    if (turnOn) {
      const started = video.play();
      if (started && typeof started.catch === "function") started.catch(() => undefined);
    }
  }, []);

  const jumpTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    const started = video.play();
    if (started && typeof started.catch === "function") started.catch(() => undefined);
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="landing-demo__video"
        poster={poster}
        width={width}
        height={height}
        muted
        playsInline
        controls
        preload="metadata"
        aria-label={label}
      >
        <source src={src} type="video/mp4" />
        {fallback}
      </video>
      <div className="landing-demo__marks">
        {marks.map((mark) => (
          <button
            className="landing-demo__mark"
            key={mark.at}
            type="button"
            onClick={() => jumpTo(mark.at)}
            aria-label={`跳到 ${mark.time}：${mark.title}`}
          >
            <b>{mark.time}</b>
            <span>{mark.label}</span>
          </button>
        ))}
        {/* The lesson's real audio, reachable without touching the player's own
            controls: a muted autoplay is the only kind a browser allows. */}
        <button
          className="landing-demo__sound"
          type="button"
          aria-pressed={soundOn}
          onClick={toggleSound}
          aria-label={soundOn ? "关闭声音" : "开启声音，听西语原声"}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9.5h3L11 6v12l-4-3.5H4z" />
            {soundOn ? <path d="M15.5 9.5a4 4 0 0 1 0 5M18.2 7a7.5 7.5 0 0 1 0 10" /> : <path d="M16 10l4 4M20 10l-4 4" />}
          </svg>
          <span>{soundOn ? "静音" : "开启声音"}</span>
        </button>
      </div>
      {/* The recording burns its subtitles into the picture, which a screen
          reader cannot read and a phone cannot enlarge, so the same three lines
          are available as text. */}
      <details className="landing-demo__transcript">
        <summary>实录里说了什么</summary>
        <ol>
          {marks.map((mark) => (
            <li key={mark.at}>
              <b>{mark.time}</b>
              <p lang="es">{mark.es}</p>
              <p>{mark.zh}</p>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
