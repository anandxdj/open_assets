import { RouteLoading } from "@/components/layout/RouteLoading";

// Last-resort fallback for any route without a nearer loading file.
export default function Loading() {
  return <RouteLoading className="min-h-dvh bg-page" />;
}
