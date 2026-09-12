import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 112,
      color: "#fffaf4",
      background: "#17211d",
      fontFamily: "serif",
      fontSize: 300,
      fontWeight: 700,
      letterSpacing: -24,
    }}>S</div>,
    size,
  );
}
