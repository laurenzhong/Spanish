import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sueño",
    short_name: "Sueño",
    description: "A speaking-first Spanish learning experience.",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F3ED",
    theme_color: "#17211D",
    lang: "zh-CN",
  };
}
