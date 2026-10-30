import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, siteUrl } from "@/lib/site";

// Public routes only. Individual community packs are not listed yet because the
// list lives behind the API, which is not reachable while the image builds.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
    url: siteUrl(path),
    lastModified,
    changeFrequency,
    priority,
  }));
}
