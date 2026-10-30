import type { MetadataRoute } from "next";
import { BRAND, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/upload",
    scope: "/",
    display: "standalone",
    background_color: BRAND.paper,
    theme_color: BRAND.ink,
    icons: [
      { src: "/icon/pwa-192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/pwa-512", sizes: "512x512", type: "image/png", purpose: "any" },
      // Same file: the monogram sits inside the maskable safe zone.
      { src: "/icon/pwa-512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
