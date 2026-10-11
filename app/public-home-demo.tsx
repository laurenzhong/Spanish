"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";

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
 * transcript following the video. It starts by itself and stops when the minute
 * is up — the clip has no audio track at all, so a browser may start it without
 * a gesture and nobody gets surprised by sound.
 *
 * Autoplay waits for the document to finish loading: the poster is the first
 * paint, and the megabyte behind it must not race the stylesheet and the app
 * shell for the visitor's bandwidth. It is skipped entirely for visitors who
 * asked for reduced motion and for metered or 2G connections — they keep the
 * poster and the native controls instead.
 */
export function PublicHomeDemo({ poster, src, width, height, label, fallback }: PublicHomeDemoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

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
