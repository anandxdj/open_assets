"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { STORAGE_MODE } from "@/features/studio/lib/app";

const MODE_ROUTES: Record<string, string> = {
  extender: "/studio/extender",
  parallax: "/studio/parallax",
  tile: "/studio/tiles",
  sprite: "/studio/sprites",
  props: "/studio/props",
};

export default function StudioIndexPage() {
  const router = useRouter();

  useEffect(() => {
    let target = MODE_ROUTES["extender"];
    try {
      const last = localStorage.getItem(STORAGE_MODE);
      if (last && MODE_ROUTES[last]) target = MODE_ROUTES[last];
    } catch {
      /* default */
    }
    router.replace(target);
  }, [router]);

  return null;
}
