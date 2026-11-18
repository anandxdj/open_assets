import { renderIcon } from "@/lib/og";

// Tab icon (the black-and-white disc) plus the two sizes the web manifest references.
// The PWA sizes are full-bleed squares with the monogram inside the maskable safe zone,
// so one file serves "any" and "maskable".
const ICONS = [
  { id: "favicon", size: 48, fill: 0.8, shape: "circle" },
  { id: "pwa-192", size: 192, fill: 0.58, shape: "square" },
  { id: "pwa-512", size: 512, fill: 0.58, shape: "square" },
] as const;

export function generateImageMetadata() {
  return ICONS.map(({ id, size }) => ({
    id,
    size: { width: size, height: size },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const iconId = await id;
  const icon = ICONS.find((candidate) => candidate.id === iconId) ?? ICONS[0];
  return renderIcon(icon.size, icon.fill, icon.shape);
}
