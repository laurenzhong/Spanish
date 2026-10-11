import { ImageResponse } from "next/og";

// 180 is what a tab, a bookmark tile and a home-screen shortcut can all use:
// the previous 512x512 raster was 16.7 KB for an icon that is never drawn
// larger than ~48 CSS px.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 39,
      color: "#fffaf4",
      background: "#17211d",
      fontFamily: "serif",
      fontSize: 108,
      fontWeight: 700,
      letterSpacing: -8,
    }}>S</div>,
    size,
  );
}
