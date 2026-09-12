import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sueño",
    short_name: "Sueño",
    description: "A speaking-first Spanish learning experience.",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F6F3ED",
    theme_color: "#17211D",
    lang: "zh-CN",
    categories: ["education"],
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
