import { ImageResponse } from "next/og";

export function renderBrandIcon(width: number, borderRadius = 0) {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius,
      color: "#fffaf4",
      background: "#17211d",
      fontFamily: "serif",
      fontSize: width * 0.6,
      fontWeight: 700,
      letterSpacing: Math.round(width * -8 / 180),
    }}>S</div>,
    { width, height: width },
  );
}
