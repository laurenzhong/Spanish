import { renderBrandIcon } from "./_brand-icon";

// 180 is what a tab, a bookmark tile and a home-screen shortcut can all use:
// the previous 512x512 raster was 16.7 KB for an icon that is never drawn
// larger than ~48 CSS px.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return renderBrandIcon(size.width, 39);
}
