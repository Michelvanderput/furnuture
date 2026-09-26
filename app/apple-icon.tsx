import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon for iPad/iPhone (Safari needs a PNG). Same sofa as icon.svg. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#e9601f" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 100, height: 34, border: "10px solid #fff", borderBottom: "none", borderRadius: "18px 18px 0 0" }} />
          <div style={{ width: 124, height: 30, background: "#fff", borderRadius: 10 }} />
          <div style={{ width: 96, display: "flex", justifyContent: "space-between" }}>
            <div style={{ width: 10, height: 16, background: "#fff", borderRadius: 4 }} />
            <div style={{ width: 10, height: 16, background: "#fff", borderRadius: 4 }} />
          </div>
        </div>
      </div>
    ),
    size,
  );
}
