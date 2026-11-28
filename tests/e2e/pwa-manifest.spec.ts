import { expect, test } from "@playwright/test";

test("serves installable icons at the dimensions declared in the manifest", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json() as { display: string; icons: { src: string; sizes: string; purpose?: string }[] };
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose?.includes("maskable"))).toBe(true);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok()).toBe(true);
    expect(image.headers()["content-type"]).toContain("image/png");
    const png = await image.body();
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }
});
