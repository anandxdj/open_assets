import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BRAND, SITE_NAME, SITE_URL } from "@/lib/site";

/**
 * Shared drawing code for the generated icons and the social share image, so
 * they follow the same brutalist system as the app: square corners, ink lines,
 * one monospace family and a single orange accent (see DESIGN.md).
 */

/** The OA monogram from components/layout/Logo.tsx as a standalone SVG data URI. */
export function brandMarkSrc(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="90 380 1370 780">` +
    `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1600"><rect x="0" y="0" width="1600" height="1600" fill="#fff"/>` +
    `<polygon points="593,1200 926,600 1100,600 1100,1200" fill="#000"/></mask>` +
    `<circle cx="480" cy="770" r="294" fill="none" stroke="${color}" stroke-width="172" mask="url(#m)"/>` +
    `<polygon points="695,1115 1100,390 1450,1115 975,1115 1075,945 1195,945 1095,750 890,1115" fill="${color}"/>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const MARK_RATIO = 780 / 1370;

/** Square icon: orange monogram centred on an ink field. `fill` is the mark's share of the width. */
export function renderIcon(size: number, fill: number) {
  const width = Math.round(size * fill);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND.ink,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
        <img src={brandMarkSrc(BRAND.orange)} width={width} height={Math.round(width * MARK_RATIO)} alt="" />
      </div>
    ),
    { width: size, height: size },
  );
}

const FONT_DIR = join(process.cwd(), "node_modules/@fontsource/jetbrains-mono/files");

async function loadFonts() {
  const [regular, bold, extraBold] = await Promise.all(
    [400, 700, 800].map((weight) => readFile(join(FONT_DIR, `jetbrains-mono-latin-${weight}-normal.woff`))),
  );
  return [
    { name: "JetBrains Mono", data: regular!, weight: 400 as const, style: "normal" as const },
    { name: "JetBrains Mono", data: bold!, weight: 700 as const, style: "normal" as const },
    { name: "JetBrains Mono", data: extraBold!, weight: 800 as const, style: "normal" as const },
  ];
}

export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_IMAGE_ALT = "OpenAssets: drop one sheet, get every asset as a transparent PNG";

const SPECS = [
  { label: "Input", value: "PNG, JPEG or WebP" },
  { label: "Detect", value: "OpenCV contours" },
  { label: "Name", value: "Vision model" },
  { label: "Output", value: "Transparent PNGs", accent: true },
];

/** 1200x630 share card used for both Open Graph and Twitter. */
export async function renderSocialImage() {
  const fonts = await loadFonts();
  const { width, height } = SOCIAL_IMAGE_SIZE;
  const line = `3px solid ${BRAND.ink}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BRAND.paper,
          color: BRAND.ink,
          fontFamily: "JetBrains Mono",
          borderBottom: `12px solid ${BRAND.orange}`,
        }}
      >
        {/* top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 88,
            padding: "0 56px",
            borderBottom: line,
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- rendered by Satori, not the browser */}
            <img src={brandMarkSrc(BRAND.ink)} width={56} height={Math.round(56 * MARK_RATIO)} alt="" />
            <div style={{ marginLeft: 18, fontSize: 28, fontWeight: 800, letterSpacing: -0.5 }}>
              {SITE_NAME.toUpperCase()}
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#4A4842" }}>{SITE_URL.host}</div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "44px 56px 0" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>
            <div style={{ width: 16, height: 16, background: BRAND.orange, marginRight: 14 }} />
            ASSET EXTRACTION FOR GAME AND UI ARTISTS
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 26,
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 0.98,
              letterSpacing: -5,
            }}
          >
            <div style={{ display: "flex" }}>DROP ONE SHEET.</div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ display: "flex", marginRight: 26 }}>GET</div>
              <div style={{ display: "flex", background: BRAND.orange, padding: "0 16px" }}>EVERY</div>
              <div style={{ display: "flex", marginLeft: 26 }}>ASSET.</div>
            </div>
          </div>
        </div>

        {/* spec strip */}
        <div style={{ display: "flex", margin: "0 56px 44px", border: line }}>
          {SPECS.map((spec, index) => (
            <div
              key={spec.label}
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                padding: "14px 20px",
                background: spec.accent ? BRAND.orange : "#FFFFFF",
                borderLeft: index === 0 ? "none" : line,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>{spec.label.toUpperCase()}</div>
              <div style={{ fontSize: 22, fontWeight: 400, marginTop: 4 }}>{spec.value}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { width, height, fonts },
  );
}
