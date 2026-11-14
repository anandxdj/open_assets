import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, siteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Signed-in app, auth flow and API: nothing here is meant for search.
      disallow: [...PRIVATE_PATHS],
    },
    sitemap: siteUrl("/sitemap.xml"),
    host: siteUrl("/"),
  };
}
