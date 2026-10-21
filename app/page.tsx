import type { Metadata, Viewport } from "next";

import PublicHomeExperience from "@/app/public-home-experience";

import "./public-home.css";

/**
 * The signed-in shell is cream and the public hero is dark. Matching the top of
 * this page keeps the iOS Safari toolbar from painting the app colour over the
 * hero; the root layout's default stays in place for every other route.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10201d",
};

/**
 * Absolute, because the root layout's `%s | Sueño` template would otherwise
 * append the wordmark a second time. The description is written in the language
 * of the page rather than inheriting the English root default.
 */
export const metadata: Metadata = {
  title: { absolute: "Sueño — 把认识的西语，变成真正说得出口的话" },
  description: "面向 A2–B1 的西语口语练习：真实语速的视频与播客、逐句字幕和词语回看，先听懂，再把完整意思说出口。",
};

export default function HomePage() {
  return <PublicHomeExperience />;
}
