import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spanish Alpha",
    short_name: "Spanish",
    description: "A speaking-first Spanish learning experience.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff8ee",
    theme_color: "#fff8ee",
    lang: "zh-CN",
  };
}
