import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("PWA manifest", () => {
  it("declares standalone scope and installable iPhone-compatible icons", () => {
    const value = manifest();
    expect(value).toMatchObject({
      id: "/",
      scope: "/",
      start_url: "/",
      display: "standalone",
      background_color: "#F6F3ED",
      theme_color: "#17211D",
    });
    expect(value.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/icon", sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ src: "/icon", sizes: "512x512", purpose: "maskable" }),
      expect.objectContaining({ src: "/apple-icon", sizes: "180x180" }),
    ]));
  });
});
