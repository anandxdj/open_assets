import { renderIcon } from "@/lib/og";

// Tab icon plus the two sizes the web manifest references. The PWA sizes keep the
// monogram inside the maskable safe zone, so one file serves "any" and "maskable".
const ICONS = [
  { id: "favicon", size: 48, fill: 0.84 },
  { id: "pwa-192", size: 192, fill: 0.58 },
  { id: "pwa-512", size: 512, fill: 0.58 },
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
  return renderIcon(icon.size, icon.fill);
}
